import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Auth } from './auth';

const ACCOUNTS_URL = 'https://accounts.tsu.ru';
const LK_URL = 'https://lk.student.tsu.ru';

export interface LkProfile {
  fullName: string;
  group: string;
  faculty: string;
  course: number;
  direction: string;
  educationProgram: string;
  educationForm: string;
  phone: string;
}

export interface Attestation {
  semester: string;
  disciplines: Array<{ name: string; mark: string; controlType: string }>;
}

export interface Debt {
  discipline: string;
}

export class LkStudentAPI {
  private auth: Auth;
  private client: AxiosInstance;
  private lkCookies: Record<string, string> = {};
  private authed = false;

  constructor(auth: Auth) {
    this.auth = auth;
    this.client = axios.create({
      withCredentials: true,
      maxRedirects: 0,
      validateStatus: (status) => status < 400 || status === 302,
    });

    this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(this.lkCookies)) {
        parts.push(`${k}=${v}`);
      }
      if (parts.length === 0) {
        const session = this.auth.getSession();
        if (session) {
          for (const [k, v] of Object.entries(session.cookies)) {
            if (k === '.ASPXAUTH' || k === 'ASP.NET_SessionId') {
              parts.push(`${k}=${v}`);
            }
          }
        }
      }
      if (parts.length) {
        config.headers.Cookie = parts.join('; ');
      }
      return config;
    });

    this.client.interceptors.response.use((resp) => {
      this.saveCookies(resp.headers as Record<string, unknown>);
      return resp;
    });
  }

  private saveCookies(headers: Record<string, unknown>): void {
    const setCookie = headers['set-cookie'];
    if (!setCookie) return;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const header of arr) {
      if (typeof header !== 'string') continue;
      const match = header.match(/^([^=]+)=([^;]+)/);
      if (match) {
        this.lkCookies[match[1]] = match[2];
      }
    }
  }

  async ensureAuth(): Promise<void> {
    if (this.authed) return;

    const loginUrl = `${LK_URL}/Authentication/Login?returnUrl=${encodeURIComponent(LK_URL + '/')}`;
    let resp = await this.client.get(loginUrl).catch(e => {
      if (e.response) {
        throw new Error(`LK login 1st GET ${loginUrl} failed: ${e.response.status}. Body: ${(e.response.data || '').toString().substring(0, 300)}`);
      }
      throw new Error(`LK login failed: ${e.message}`);
    });

    for (let hops = 0; hops < 10; hops++) {
      let location = typeof resp.headers['location'] === 'string' ? resp.headers['location'] : '';
      if (!location) {
        const h = typeof resp.data === 'string' ? resp.data : '';
        const m = h.match(/location\s*=\s*['"]([^'"]+)/i);
        if (m) location = m[1];
      }

      if (location) {
        const fullLoc = location.startsWith('http') ? location : `${LK_URL}${location}`;
        resp = await this.client.get(fullLoc);
        continue;
      }

      const html = typeof resp.data === 'string' ? resp.data : '';

      if (html.includes('Войти под этим аккаунтом')) {
        const chooseAction = html.match(/<form[^>]+action="([^"]+)"[^>]*>/i)?.[1] || '/Account/Choose2';
        const fd = new URLSearchParams();
        const inputs = html.matchAll(/<input[^>]+name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/gi);
        for (const inp of inputs) fd.append(inp[1], inp[2]);
        const fullAction = chooseAction.startsWith('http') ? chooseAction : `${ACCOUNTS_URL}${chooseAction}`;
        resp = await this.client.post(fullAction, fd.toString(), {
          maxRedirects: 0,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        continue;
      }

      if (html.includes('Email') && html.includes('Пароль')) {
        const vt = html.match(/__RequestVerificationToken.*?value="([^"]+)"/s)?.[1];
        if (!vt) throw new Error('No verification token');
        const email = process.env['TSU_EMAIL'] || '';
        const password = process.env['TSU_PASSWORD'] || '';
        if (!email || !password) throw new Error('TSU_EMAIL/TSU_PASSWORD not set');
        const formData = new URLSearchParams();
        formData.append('__RequestVerificationToken', vt);
        formData.append('Email', email);
        formData.append('Password', password);
        formData.append('ApplicationId', '1014');
        formData.append('rememberMe', 'true');
        resp = await this.client.post(`${ACCOUNTS_URL}/Account/Login2`, formData.toString(), {
          maxRedirects: 0,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        continue;
      }

      if (html.includes('Выйти') || html.includes('/Authentication/Logout') || html.includes('Асманов') || html.includes('Личный Кабинет')) {
        this.authed = true;
        return;
      }

      if (html.includes('Выполнить вход') && html.includes('ТГУ.Аккаунты')) {
        const vt = html.match(/__RequestVerificationToken.*?value="([^"]+)"/s)?.[1];
        if (!vt) throw new Error('No verification token on accounts login page');
        const email = process.env['TSU_EMAIL'] || '';
        const password = process.env['TSU_PASSWORD'] || '';
        if (!email || !password) throw new Error('TSU_EMAIL/TSU_PASSWORD not set');
        const formData = new URLSearchParams();
        formData.append('__RequestVerificationToken', vt);
        formData.append('Email', email);
        formData.append('Password', password);
        // read ApplicationId from page or default
        const appId = html.match(/name="ApplicationId"[^>]*value="(\d+)"/)?.[1] || '1014';
        formData.append('ApplicationId', appId);
        formData.append('rememberMe', 'true');
        resp = await this.client.post(`${ACCOUNTS_URL}/Account/Login2`, formData.toString(), {
          maxRedirects: 0,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        continue;
      }

      throw new Error(`LK auth unknown page: ${html.substring(0, 2000)}`);
    }

    throw new Error('LK auth: too many redirects');
  }

  private async get(path: string): Promise<string> {
    await this.ensureAuth();
    const resp = await this.client.get(`${LK_URL}${path}`, {
      maxRedirects: 5,
      validateStatus: () => true,
    });
    const html = typeof resp.data === 'string' ? resp.data : '';
    const isLoginPage = html.includes('name="Email"') && html.includes('name="Password"');
    if (resp.status !== 200 || isLoginPage) {
      this.authed = false;
      await this.ensureAuth();
      const retry = await this.client.get(`${LK_URL}${path}`, { maxRedirects: 5 });
      const retryHtml = typeof retry.data === 'string' ? retry.data : '';
      const stillLogin = retryHtml.includes('name="Email"') && retryHtml.includes('name="Password"');
      if (stillLogin) {
        throw new Error(`LK reauth failed for ${path}. Cookies: ${Object.keys(this.lkCookies).join(',')}. Body: ${retryHtml.substring(0, 500)}`);
      }
      return retryHtml;
    }
    return html;
  }

  async getProfile(): Promise<LkProfile> {
    const html = await this.get('/profile');

    const fullName = html.match(/<h4[^>]*>\s*([^<]+?)\s*-?\s*</)?.[1]?.trim() || '';

    const listItems = html.matchAll(
      /<div class="list-group-item-text">([^<]+)<\/div>\s*<div class="list-group-item-title">([^<]+)<\/div>/g,
    );
    const data: Record<string, string> = {};
    for (const m of listItems) {
      data[m[1].trim()] = m[2].trim();
    }

    const facultyGroup = (data['Факультет, группа'] || '').split(/,\s*/);
    const faculty = facultyGroup[0] || '';
    const group = facultyGroup[1] || '';
    const course = parseInt(data['Курс'] || '0', 10);
    const direction = data['Направление'] || '';
    const educationProgram = data['Образовательная программа'] || '';
    const educationForm = data['Форма обучения, база'] || '';

    const phoneMatch = html.match(/Телефон, указанный в деканате<\/div>\s*<div class="list-group-item-title">([^<]+)<\/div>/);
    const phone = phoneMatch?.[1]?.trim() || '';

    return { fullName, group, faculty, course, direction, educationProgram, educationForm, phone };
  }

  async getAttestations(): Promise<Attestation[]> {
    await this.ensureAuth();
    const resp = await this.client.get(`${LK_URL}/attestation`, {
      maxRedirects: 5,
      validateStatus: () => true,
    });
    const html = typeof resp.data === 'string' ? resp.data : '';
    if (resp.status !== 200) {
      throw new Error(`LK /attestation status=${resp.status}. Body=${html.substring(0, 500)}`);
    }

    const result: Attestation[] = [];

    const cardRe = /<div class="card shadow-none mb-1">/gi;
    const cardPositions: number[] = [];
    let cardMatch: RegExpExecArray | null;
    while ((cardMatch = cardRe.exec(html)) !== null) {
      cardPositions.push(cardMatch.index);
    }

    for (let ci = 0; ci < cardPositions.length; ci++) {
      const cardStart = cardPositions[ci];
      const cardEnd = ci + 1 < cardPositions.length ? cardPositions[ci + 1] : html.length;
      const cardHtml = html.substring(cardStart, cardEnd);

      const nameMatch = cardHtml.match(/card-header[^>]*>\s*([А-Я][а-я]+)\s*семестр\s*<\/div>/);
      const semName = nameMatch?.[1]?.trim();
      if (!semName) continue;

      const listStart = cardHtml.indexOf('<div class="list-group list-group-flush">');
      if (listStart === -1) continue;

      let depth = 1;
      let pos = listStart + '<div class="list-group list-group-flush">'.length;
      while (depth > 0 && pos < cardHtml.length) {
        const nextOpen = cardHtml.indexOf('<div', pos);
        const nextClose = cardHtml.indexOf('</div>', pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          pos = nextClose + 6;
        }
      }
      const listBlock = cardHtml.substring(listStart, pos);

      const disciplines: Array<{ name: string; mark: string; controlType: string }> = [];
      const itemRe = /<div class="list-group-item\b(?!-title|-body|-text)[^"]*">/gi;
      const itemPositions: number[] = [];
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRe.exec(listBlock)) !== null) {
        itemPositions.push(itemMatch.index);
      }

      for (let i = 0; i < itemPositions.length; i++) {
        const itemStart = itemPositions[i];
        const itemEnd = i + 1 < itemPositions.length ? itemPositions[i + 1] : listBlock.length;
        const itemHtml = listBlock.substring(itemStart, itemEnd);

        const titleRe = /list-group-item-title[^>]*>([\s\S]*?)<\/div>\s*<\/div>/;
        const titleMatch = itemHtml.match(titleRe);
        const titleBlock = titleMatch?.[1] || '';

        const nameMatch = titleBlock.match(/<div>([^<]*)<\/div>/);
        const name = nameMatch?.[1]?.trim() || '';

        let mark = '';
        const markSpan = titleBlock.match(/<span[^>]*>([^<]*)<\/span>/);
        if (markSpan) {
          mark = markSpan[1].trim();
        } else {
          const flexMatch = titleBlock.match(/class="align-self-end">([^<]+)</);
          mark = flexMatch?.[1]?.trim() || '';
        }

        const controlMatch = itemHtml.match(/Вид контроля\s*-\s*<span[^>]*>([^<]+)<\/span>/);
        const controlType = controlMatch?.[1]?.trim() || '';

        if (name) {
          disciplines.push({ name, mark, controlType });
        }
      }

      if (disciplines.length > 0) {
        result.push({ semester: `${semName} семестр`, disciplines });
      }
    }

    if (result.length === 0) {
      const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 3000);
      throw new Error(`Attestation no data. Cards found: ${(html.match(/card shadow-none mb-1/g) || []).length}. Text: ${stripped}`);
    }

    return result;
  }

  async getDebts(): Promise<Debt[]> {
    const html = await this.get('/');
    const debts: Debt[] = [];

    const blockRe = /Академические задолженности[\s\S]*?<\/h3>([\s\S]*?)(?=<h[1-6]|$)/i;
    const blockMatch = html.match(blockRe);
    if (!blockMatch) return debts;

    const itemRe = /class="card-header[^"]*"[^>]*>\s*([^<]+)\s*</gi;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemRe.exec(blockMatch[1])) !== null) {
      const name = itemMatch[1].trim();
      if (name && !name.includes('Академические')) {
        debts.push({ discipline: name });
      }
    }

    return debts;
  }
}
