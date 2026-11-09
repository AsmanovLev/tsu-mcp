import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SessionData, loadSession, saveSession, isSessionExpired } from './session';

const LMS_URL = 'https://lms.tsu.ru';
const ACCOUNTS_URL = 'https://accounts.tsu.ru';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

/** Коды Moodle, которыми он сообщает «сессии нет / ключ недействителен». */
const SESSION_INVALID_CODES = new Set(['servicerequireslogin', 'invalidtoken', 'accessexception']);

interface CookieJar {
  [key: string]: string;
}

export class Auth {
  private client: AxiosInstance;
  private session: SessionData | null = null;
  private cookies: CookieJar = {};

  constructor() {
    this.client = axios.create({
      withCredentials: true,
      maxRedirects: 3,
      validateStatus: (status) => status < 400 || status === 302,
      proxy: false,
    });

    this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const cookieStr = this.getCookieString();
      if (cookieStr) {
        config.headers.Cookie = cookieStr;
      }
      return config;
    });

    this.client.interceptors.response.use((resp) => {
      this.saveCookiesFromResponse(resp.headers as Record<string, unknown>);
      return resp;
    });

    const saved = loadSession();
    if (saved && !isSessionExpired(saved)) {
      this.session = saved;
      this.cookies = { ...saved.cookies };
    }
  }

  private getCookieString(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private saveCookiesFromResponse(headers: Record<string, unknown>): void {
    const setCookie = headers['set-cookie'];
    if (!setCookie) return;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const header of arr) {
      if (typeof header !== 'string') continue;
      const match = header.match(/^([^=]+)=([^;]+)/);
      if (match) {
        this.cookies[match[1]] = match[2];
      }
    }
  }

  private async extractSesskey(html: string): Promise<{ sesskey: string; userid: number }> {
    const patterns = [
      /sesskey\s*=\s*"([^"]+)"/,
      /sesskey\s*:\s*"([^"]+)"/,
      /"sesskey"\s*:\s*"([^"]+)"/,
      /sesskey=([a-zA-Z0-9]+)/,
    ];
    let sesskey = '';
    for (const p of patterns) {
      const m = html.match(p);
      if (m) { sesskey = m[1]; break; }
    }
    if (!sesskey) throw new Error('Could not extract sesskey from LMS page');

    const useridMatch = html.match(/userid\s*:\s*"(\d+)"/)
      || html.match(/"userid"\s*:\s*(\d+)/)
      || html.match(/data-userid="(\d+)"/);
    const userid = useridMatch ? parseInt(useridMatch[1], 10) : 0;

    return { sesskey, userid };
  }

  async login(email: string, password: string): Promise<SessionData> {
    this.cookies = {};

    const loginUrl = `${LMS_URL}/login/accounts_tsu/login.php`;
    let resp = await this.client.get(loginUrl, { maxRedirects: 0 });

    let location = typeof resp.headers['location'] === 'string' ? resp.headers['location'] : '';
    if (location) {
      resp = await this.client.get(
        location.startsWith('http') ? location : `${ACCOUNTS_URL}${location}`,
        { maxRedirects: 0 },
      );
    }

    let html = typeof resp.data === 'string' ? resp.data : '';
    let vt = this.extractVerificationToken(html);

    if (!vt) {
      const actionMatch = html.match(/action="([^"]+)"/);
      if (actionMatch) {
        const actionUrl = actionMatch[1];
        const fullAction = actionUrl.startsWith('http') ? actionUrl : `${ACCOUNTS_URL}${actionUrl}`;
        resp = await this.client.post(fullAction, null, { maxRedirects: 0 });
        html = typeof resp.data === 'string' ? resp.data : '';
        vt = this.extractVerificationToken(html);
      }
    }

    if (!vt) {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) vt = this.extractVerificationToken(bodyMatch[1]);
    }

    if (!vt) {
      throw new Error('Could not find verification token on accounts page');
    }

    const loginFormUrl = `${ACCOUNTS_URL}/Account/Login2`;
    const formData = new URLSearchParams();
    formData.append('__RequestVerificationToken', vt);
    formData.append('Email', email);
    formData.append('Password', password);
    formData.append('ApplicationId', '1067');
    formData.append('rememberMe', 'true');

    resp = await this.client.post(loginFormUrl, formData.toString(), {
      maxRedirects: 0,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    location = typeof resp.headers['location'] === 'string' ? resp.headers['location'] : '';
    if (!location) {
      const locMatch = typeof resp.data === 'string' ? resp.data.match(/location\s*=\s*['"]([^'"]+)/i) : null;
      if (locMatch) location = locMatch[1];
    }

    if (!location) {
      location = await this.handleSamlForm(resp);
    }

    if (location) {
      resp = await this.followToLms(location);
    }

    const finalHtml = typeof resp.data === 'string' ? resp.data : '';
    if (!finalHtml.includes('sesskey')) {
      resp = await this.client.get(`${LMS_URL}/my/`, { maxRedirects: 3 });
      const profileHtml = typeof resp.data === 'string' ? resp.data : '';
      if (!profileHtml.includes('sesskey')) {
        throw new Error('Reached LMS but no sesskey found in page');
      }
      const { sesskey, userid } = await this.extractSesskey(profileHtml);
      this.session = { cookies: { ...this.cookies }, sesskey, userid, expires: new Date(Date.now() + SESSION_DURATION_MS).toISOString() };
    } else {
      const { sesskey, userid } = await this.extractSesskey(finalHtml);
      this.session = { cookies: { ...this.cookies }, sesskey, userid, expires: new Date(Date.now() + SESSION_DURATION_MS).toISOString() };
    }

    await this.assertSessionValid(this.session);
    saveSession(this.session);
    return this.session;
  }

  /**
   * Moodle отдаёт sesskey и на гостевой странице, поэтому его наличие ничего не доказывает:
   * при неверном пароле вход «успешно» завершался, а падало только на первом запросе.
   *
   * Две проверки: гостевая сессия не имеет userid, а рабочий AJAX-вызов на невалидной сессии
   * отвечает servicerequireslogin / invalidtoken. Прочие ошибки (например servicenotavailable
   * у отдельных функций ТГУ) авторизацию не опровергают и игнорируются.
   */
  private async assertSessionValid(session: SessionData): Promise<void> {
    if (!session.userid) {
      this.resetSession();
      throw new Error('LMS auth: вход не выполнен (нет userid) — проверьте TSU_EMAIL и TSU_PASSWORD');
    }

    const url = `${LMS_URL}/lib/ajax/service.php?sesskey=${encodeURIComponent(session.sesskey)}`
      + '&info=core_course_get_enrolled_courses_by_timeline_v2';
    let body: unknown;
    try {
      const resp = await this.client.post(
        url,
        [{
          index: 0,
          methodname: 'core_course_get_enrolled_courses_by_timeline_v2',
          args: { classification: 'inprogress', limit: 1, offset: 0 },
        }],
        { headers: { 'Content-Type': 'application/json' }, maxRedirects: 0 },
      );
      body = resp.data;
    } catch (err) {
      this.resetSession();
      throw new Error(`LMS auth: проверка сессии не удалась (${err instanceof Error ? err.message : String(err)})`);
    }

    const first = Array.isArray(body) ? (body[0] as Record<string, unknown>) : (body as Record<string, unknown> | null);
    const errcode = ((first?.errorcode as string | undefined)
      ?? ((first?.exception as Record<string, unknown> | undefined)?.errorcode as string | undefined)
      ?? '').toLowerCase();

    if (SESSION_INVALID_CODES.has(errcode)) {
      this.resetSession();
      throw new Error(
        'LMS auth: неверный логин или пароль'
        + (errcode ? ` (${errcode})` : '')
        + '. Проверьте TSU_EMAIL и TSU_PASSWORD в .env',
      );
    }
  }

  private resetSession(): void {
    this.session = null;
    this.cookies = {};
    try {
      const file = path.resolve(__dirname, 'session.json');
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* best-effort: не мешаем основному потоку ошибки */
    }
  }

  private extractVerificationToken(html: string): string {
    const patterns = [
      /__RequestVerificationToken.*?value="([^"]+)"/s,
      /name="__RequestVerificationToken".*?value="([^"]+)"/s,
      /__RequestVerificationToken"\s*:\s*"([^"]+)"/,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return m[1];
    }
    return '';
  }

  private async handleSamlForm(resp: { data: unknown; headers: Record<string, unknown> }): Promise<string> {
    const html = typeof resp.data === 'string' ? resp.data : '';

    const formMatch = html.match(/<form[^>]+action="([^"]+)"[^>]*>/i);
    if (formMatch) {
      const action = formMatch[1];
      const inputs = html.matchAll(/<input[^>]+name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/gi);
      const formData = new URLSearchParams();
      for (const input of inputs) {
        formData.append(input[1], input[2]);
      }

      const fullAction = action.startsWith('http') ? action : `${ACCOUNTS_URL}${action}`;
      const samlResp = await this.client.post(fullAction, formData.toString(), {
        maxRedirects: 0,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      let location = typeof samlResp.headers['location'] === 'string' ? samlResp.headers['location'] : '';
      if (!location) {
        const sHtml = typeof samlResp.data === 'string' ? samlResp.data : '';
        const locMatch = sHtml.match(/location\s*=\s*['"]([^'"]+)/i);
        if (locMatch) location = locMatch[1];
      }
      if (location) return location;
    }

    const chooseMatch = html.match(/action="([^"]*\/Choose[^"]*)"[^>]*>/i);
    if (chooseMatch) {
      const chooseAction = chooseMatch[1];
      const fullChoose = chooseAction.startsWith('http') ? chooseAction : `${ACCOUNTS_URL}${chooseAction}`;
      const chooseResp = await this.client.post(fullChoose, null, { maxRedirects: 0 });
      return typeof chooseResp.headers['location'] === 'string' ? chooseResp.headers['location'] : '';
    }

    return '';
  }

  private async followToLms(location: string) {
    const maxHops = 10;
    let currentUrl = location.startsWith('http') ? location : `${LMS_URL}${location}`;
    let resp = await this.client.get(currentUrl, { maxRedirects: 0 });

    for (let i = 0; i < maxHops; i++) {

      const loc = typeof resp.headers['location'] === 'string' ? resp.headers['location'] : '';
      if (!loc) {
        // Handle refresh header (used by lms.tsu.ru login_confirm.php)
        const refresh = typeof resp.headers['refresh'] === 'string' ? resp.headers['refresh'] : '';
        const refreshMatch = refresh.match(/url=(.+)/i);
        if (refreshMatch) {
          const refreshUrl = refreshMatch[1].trim();
          currentUrl = refreshUrl.startsWith('http') ? refreshUrl : `${LMS_URL}${refreshUrl}`;
          resp = await this.client.get(currentUrl, { maxRedirects: 0 });
          continue;
        }

        if (currentUrl.includes('accounts.tsu.ru')) {
          const h = typeof resp.data === 'string' ? resp.data : '';
          const formActionMatch = h.match(/<form[^>]+action="([^"]+)"[^>]*>/i);
          if (formActionMatch) {
            const formAction = formActionMatch[1];
            const inputs = h.matchAll(/<input[^>]+name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/gi);
            const fd = new URLSearchParams();
            for (const inp of inputs) fd.append(inp[1], inp[2]);
            const fullFormAction = formAction.startsWith('http') ? formAction : `${LMS_URL}${formAction}`;
            resp = await this.client.post(fullFormAction, fd.toString(), {
              maxRedirects: 3,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });
          }
        }
        break;
      }

      const fullLoc = loc.startsWith('http') ? loc : `${LMS_URL}${loc}`;
      if (fullLoc === currentUrl) break;
      currentUrl = fullLoc;
      resp = await this.client.get(currentUrl, { maxRedirects: 0 });
    }

    return resp;
  }

  getClient(): AxiosInstance {
    return this.client;
  }

  getSession(): SessionData | null {
    return this.session;
  }

  getSesskey(): string {
    return this.session?.sesskey || '';
  }

  isAuthenticated(): boolean {
    return !!this.session && !isSessionExpired(this.session);
  }

  async ensureAuth(email: string, password: string): Promise<void> {
    if (!this.isAuthenticated()) {
      await this.login(email, password);
    }
  }
}
