import { Auth } from './auth';

const LMS_URL = 'https://lms.tsu.ru';
const AJAX_SERVICE = '/lib/ajax/service.php';

interface AjaxCall {
  index: number;
  methodname: string;
  args: Record<string, unknown>;
}

export class MoodleAPI {
  private auth: Auth;

  constructor(auth: Auth) {
    this.auth = auth;
  }

  async call(functions: AjaxCall[]): Promise<unknown[]> {
    const session = this.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const url = `${LMS_URL}${AJAX_SERVICE}?sesskey=${session.sesskey}&info=${functions.map(f => f.methodname).join(',')}`;

    const resp = await this.auth.getClient().post(url, functions, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return resp.data;
  }

  async callSingle(methodname: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const results = await this.call([{ index: 0, methodname, args }]);
    if (Array.isArray(results) && results.length > 0) {
      const result = results[0] as { data?: unknown; error?: boolean; message?: string };
      if (result.error) {
        console.error(`API error in ${methodname}:`, JSON.stringify(result));
        throw new Error(result.message || `API error in ${methodname}`);
      }
      const data = result.data !== undefined ? result.data : result;
      if (Array.isArray(data) && data.length === 0) {
        console.error(`Empty response for ${methodname}`, JSON.stringify(result));
      }
      return data;
    }
    console.error(`Non-array response for ${methodname}:`, JSON.stringify(results));
    return results;
  }
}
