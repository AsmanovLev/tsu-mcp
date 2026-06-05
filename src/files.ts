import * as fs from 'fs';
import { Auth } from './auth';

const LMS_URL = 'https://lms.tsu.ru';

export class Files {
  private auth: Auth;

  constructor(auth: Auth) {
    this.auth = auth;
  }

  async download(fileUrl: string, outputPath: string): Promise<string> {
    let fullUrl = fileUrl.startsWith('http') ? fileUrl : `${LMS_URL}${fileUrl}`;

    if (fullUrl.includes('/mod/resource/view.php')) {
      const head = await this.auth.getClient().get(fullUrl, {
        maxRedirects: 0,
        validateStatus: (s: number) => s < 400 || s === 302 || s === 303,
      });
      const location = head.headers['location'] as string | undefined;
      if (location) {
        fullUrl = location.startsWith('http') ? location : `${LMS_URL}${location}`;
      }
    }

    const resp = await this.auth.getClient().get(fullUrl, {
      responseType: 'stream',
      maxRedirects: 5,
    });

    const writer = fs.createWriteStream(outputPath);
    resp.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(outputPath));
      writer.on('error', reject);
    });
  }

  async listFolderContents(folderId: number): Promise<Array<{ name: string; url: string }>> {
    const resp = await this.auth.getClient().get(`${LMS_URL}/mod/folder/view.php?id=${folderId}`);
    const html = typeof resp.data === 'string' ? resp.data : '';

    const files: Array<{ name: string; url: string }> = [];
    const re = /<a[^>]+href="([^"]*pluginfile[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((match = re.exec(html)) !== null) {
      const url = match[1].startsWith('http') ? match[1] : `${LMS_URL}${match[1]}`;
      const name = match[2].replace(/<[^>]+>/g, '').trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        files.push({ name, url });
      }
    }
    return files;
  }

  async getCourseFiles(courseId: number): Promise<Array<{ name: string; url: string; type: string; modId: number }>> {
    const resp = await this.auth.getClient().get(`${LMS_URL}/course/view.php?id=${courseId}`);
    const html = typeof resp.data === 'string' ? resp.data : '';

    const result: Array<{ name: string; url: string; type: string; modId: number }> = [];
    const re = /<a[^>]+href="([^"]*(mod\/(resource|folder|url)\/view\.php\?id=(\d+))[^"]*)"[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      const fullUrl = match[1];
      const type = match[3];
      const modId = parseInt(match[4], 10);

      const anchorEnd = html.indexOf('</a>', match.index);
      const anchorHtml = anchorEnd !== -1 ? html.substring(match.index, anchorEnd) : '';

      const nameRe = /instancename[^>]*>([\s\S]*?)<\/span>/i;
      const nameMatch = anchorHtml.match(nameRe);
      let name = nameMatch ? stripHtml(nameMatch[1]).trim() : '';
      if (!name) {
        const simpleText = anchorHtml.replace(/<[^>]+>/g, '').trim();
        name = simpleText;
      }

      if (name && !result.some(r => r.modId === modId)) {
        result.push({ name, url: fullUrl.startsWith('http') ? fullUrl : `${LMS_URL}${fullUrl}`, type, modId });
      }
    }

    return result;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}
