import * as fs from 'fs';
import * as path from 'path';
import { Auth } from './auth';

const LMS_URL = 'https://lms.tsu.ru';

export class Files {
  private auth: Auth;

  constructor(auth: Auth) {
    this.auth = auth;
  }

  async download(fileUrl: string, outputPath: string): Promise<string> {
    let trimmed = fileUrl.trim();
    if (/^\d+$/.test(trimmed)) {
      trimmed = `/mod/resource/view.php?id=${trimmed}`;
    }

    let fullUrl = trimmed.startsWith('http') ? trimmed : `${LMS_URL}${trimmed}`;

    if (fullUrl.includes('/mod/folder/view.php')) {
      fullUrl = fullUrl.replace('/mod/folder/view.php', '/mod/folder/download_folder.php');
    } else if (fullUrl.includes('/mod/resource/view.php') || fullUrl.includes('/mod/url/view.php')) {
      const redirectUrl = fullUrl.includes('?') ? `${fullUrl}&redirect=1` : `${fullUrl}?redirect=1`;
      const head = await this.auth.getClient().get(redirectUrl, {
        maxRedirects: 0,
        validateStatus: () => true,
      });

      const location = head.headers['location'] as string | undefined;
      if (location) {
        fullUrl = location.startsWith('http') ? location : `${LMS_URL}${location}`;
      } else if (head.status === 200 && typeof head.data === 'string') {
        const html = head.data;
        const workaroundMatch = html.match(/class="resourceworkaround"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i);
        const objectMatch = html.match(/<object[^>]+data="([^"]+)"/i);
        const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
        const embedMatch = html.match(/<embed[^>]+src="([^"]+)"/i);
        const modPluginMatch = html.match(/https?:\/\/[^"'\s]*\/pluginfile\.php\/[^"'\s]*mod_resource\/content\/[^"'\s]*/i);
        const generalPluginMatch = html.match(/https?:\/\/[^"'\s]*\/pluginfile\.php\/(?!\d+\/theme_|\d+\/pix)[^"'\s]*/i);

        const extracted = workaroundMatch?.[1]
          || objectMatch?.[1]
          || iframeMatch?.[1]
          || embedMatch?.[1]
          || modPluginMatch?.[0]
          || generalPluginMatch?.[0];

        if (extracted) {
          fullUrl = extracted.startsWith('http') ? extracted : `${LMS_URL}${extracted}`;
        }
      }
    }

    fullUrl = fullUrl.replace(/&amp;/g, '&');

    const resolvedOut = path.resolve(outputPath);
    const dir = path.dirname(resolvedOut);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const resp = await this.auth.getClient().get(fullUrl, {
      responseType: 'stream',
      maxRedirects: 5,
    });

    const contentType = (resp.headers['content-type'] as string) || '';
    const ext = path.extname(resolvedOut).toLowerCase();

    if (contentType.includes('text/html') && ext && ext !== '.html' && ext !== '.htm') {
      const chunks: Buffer[] = [];
      for await (const chunk of resp.data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const htmlBody = Buffer.concat(chunks).toString('utf-8');
      const errMatch = htmlBody.match(/class="errormessage">([\s\S]*?)<\/p>/i);
      const msg = errMatch ? stripHtml(errMatch[1]).trim() : 'Server returned an HTML page instead of the requested file';
      throw new Error(`Failed to download file from ${fullUrl}: ${msg}`);
    }

    const writer = fs.createWriteStream(resolvedOut);
    resp.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(resolvedOut));
      writer.on('error', (err) => {
        try {
          if (fs.existsSync(resolvedOut)) fs.unlinkSync(resolvedOut);
        } catch {}
        reject(err);
      });
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
      const rawUrl = match[1].replace(/&amp;/g, '&');
      const url = rawUrl.startsWith('http') ? rawUrl : `${LMS_URL}${rawUrl}`;
      const name = decodeHtml(match[2].replace(/<[^>]+>/g, '').trim());
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
      const fullUrl = match[1].replace(/&amp;/g, '&');
      const type = match[3];
      const modId = parseInt(match[4], 10);

      const anchorEnd = html.indexOf('</a>', match.index);
      const anchorHtml = anchorEnd !== -1 ? html.substring(match.index, anchorEnd) : '';

      const nameMatch = anchorHtml.match(/instancename[^>]*>([\s\S]*?)<\/span>/i);
      let name = '';
      if (nameMatch) {
        name = cleanName(nameMatch[1]);
      } else {
        name = cleanName(anchorHtml);
      }

      if (name && !result.some((r) => r.modId === modId)) {
        result.push({
          name,
          url: fullUrl.startsWith('http') ? fullUrl : `${LMS_URL}${fullUrl}`,
          type,
          modId,
        });
      }
    }

    return result;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function cleanName(raw: string): string {
  let cleaned = raw.replace(/<span\b[^>]*\baccesshide\b[^>]*>[\s\S]*?<\/span>/gi, '');
  cleaned = stripHtml(cleaned);
  cleaned = decodeHtml(cleaned);
  cleaned = cleaned.replace(/\s+(?:Файл|Папка|Гиперссылка|Задание|Тест|Викторина|Форум)\s*$/i, '');
  return cleaned.replace(/\s+/g, ' ').trim();
}
