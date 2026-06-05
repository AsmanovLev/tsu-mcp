import { Auth } from './auth';
import { MoodleAPI } from './api';

const LMS_URL = 'https://lms.tsu.ru';

export interface Course {
  id: number;
  shortname: string;
  fullname: string;
  summary: string;
  startdate: number;
  enddate: number;
  category: number;
}

export interface CourseContent {
  id: number;
  name: string;
  visible: number;
  summary: string;
  section: number;
  modules: CourseModule[];
}

export interface CourseModule {
  id: number;
  name: string;
  modname: string;
  url?: string;
  description?: string;
  visible: number;
}

export class Courses {
  private api: MoodleAPI;
  private auth: Auth;

  constructor(api: MoodleAPI, auth: Auth) {
    this.api = api;
    this.auth = auth;
  }

  async getAll(): Promise<Course[]> {
    const v2 = await this.api.callSingle('core_course_get_enrolled_courses_by_timeline_v2', {
      offset: 0, limit: 100, classification: 'inprogress', sort: 'fullname', userid: 0,
    }).catch(() => null) as { courses: Course[] } | null;
    if (v2?.courses?.length) return v2.courses;

    const v1 = await this.api.callSingle('core_course_get_enrolled_courses_by_timeline', {
      offset: 0, limit: 100, classification: 'inprogress', sort: 'fullname', userid: 0,
    }).catch(() => null) as { courses: Course[] } | null;
    if (v1?.courses?.length) return v1.courses;

    const recent = await this.api.callSingle('core_course_get_recent_courses', {
      userid: 0, limit: 100, offset: 0,
    }).catch(() => null) as Course[] | null;
    if (recent?.length) return recent;

    const items = await this.api.callSingle('block_recentlyaccesseditems_get_recent_items', {}).catch(() => null) as Array<{ cmid: number; courseid: number; name: string }> | null;
    if (items?.length) {
      const ids = [...new Set(items.map(i => i.courseid))];
      const result = await this.api.callSingle('core_course_get_courses', {
        options: { ids },
      }) as Course[];
      return result.filter(c => c.id > 1);
    }

    throw new Error('Could not retrieve courses. Check LMS authentication.');
  }

  async getById(courseId: number): Promise<Course | null> {
    const courses = await this.getAll();
    return courses.find(c => c.id === courseId) || null;
  }

  async getContents(courseId: number): Promise<CourseContent[]> {
    try {
      return await this.api.callSingle('core_course_get_contents', {
        courseid: courseId,
      }) as CourseContent[];
    } catch {
      return this.scrapeContents(courseId);
    }
  }

  private extractModId(href: string): number {
    const m = href.match(/[?&]id=(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  private extractModName(anchorHtml: string): string {
    const instStart = anchorHtml.indexOf('instancename');
    if (instStart === -1) return anchorHtml.replace(/<[^>]+>/g, '').trim();

    const contentStart = anchorHtml.indexOf('>', instStart) + 1;
    let contentEnd = anchorHtml.indexOf('</span>', contentStart);
    if (contentEnd === -1) return anchorHtml.replace(/<[^>]+>/g, '').trim();

    let content = anchorHtml.substring(contentStart, contentEnd + 7);

    let prev: string;
    do {
      prev = content;
      content = content.replace(/<span\b[^>]*\baccesshide\b[^>]*>[\s\S]*?<\/span>/gi, '');
    } while (content !== prev);

    content = content.replace(/<[^>]+>/g, '');
    return content.replace(/\s+/g, ' ').trim();
  }

  async scrapeContents(courseId: number): Promise<CourseContent[]> {
    const resp = await this.auth.getClient().get(`${LMS_URL}/course/view.php?id=${courseId}`);
    const html = typeof resp.data === 'string' ? resp.data : '';

    const sectionPositions: Array<{ num: number; start: number; name: string }> = [];
    const sectionRe = /<li[^>]+id="section-(\d+)"[^>]*>/gi;
    let secMatch: RegExpExecArray | null;
    while ((secMatch = sectionRe.exec(html)) !== null) {
      const num = parseInt(secMatch[1], 10);
      const nameRe = /sectionname[^>]*>([\s\S]*?)<\/div>/i;
      const afterOpen = html.substring(secMatch.index, secMatch.index + 2000);
      const nm = afterOpen.match(nameRe);
      const name = nm ? nm[1].replace(/<[^>]+>/g, '').trim() : '';
      sectionPositions.push({ num, start: secMatch.index, name });
    }

    const modulesBySection: Map<number, CourseModule[]> = new Map();
    const actRe = /<li[^>]+class="[^"]*activity[^"]*"[^>]*>/gi;
    let actMatch: RegExpExecArray | null;
    while ((actMatch = actRe.exec(html)) !== null) {
      const modId = parseInt(actMatch[0].match(/id="module-(\d+)"/)?.[1] || '0', 10);
      const actStart = actMatch.index;

      let depth = 1;
      let pos = actStart + actMatch[0].length;
      while (depth > 0 && pos < html.length) {
        const nextOpen = html.indexOf('<li', pos);
        const nextClose = html.indexOf('</li>', pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) { depth++; pos = nextOpen + 3; }
        else { depth--; pos = nextClose + 5; }
      }
      const actHtml = html.substring(actStart, pos);

      const modRe = actHtml.match(/class="[^"]*modtype_(\w+)[^"]*"/);
      const modname = modRe?.[1] || '';

      let href = '';
      let linkModId = 0;
      let modName = '';

      const nameLinkRe = /<a[^>]*href="([^"]*\/mod\/[^"]*)"[^>]*>\s*<span class="instancename">/gi;
      const nlr = nameLinkRe.exec(actHtml);
      if (nlr) {
        href = nlr[1];
        linkModId = this.extractModId(href);
        const closeIdx = actHtml.indexOf('</a>', nlr.index);
        if (closeIdx !== -1) {
          modName = this.extractModName(actHtml.substring(nlr.index, closeIdx + 4));
        }
      } else {
        const fallbackLink = actHtml.match(/<a[^>]*href="([^"]*\/mod\/[^"]*)"[^>]*>/i);
        if (fallbackLink) {
          href = fallbackLink[1];
          linkModId = this.extractModId(href);
        }
      }

      const finalId = linkModId || modId;
      if (finalId && modname) {
        const sectionIdx = [...sectionPositions].reverse().find(s => s.start < actStart);
        const secNum = sectionIdx?.num ?? 0;
        if (!modulesBySection.has(secNum)) modulesBySection.set(secNum, []);
        modulesBySection.get(secNum)!.push({
          id: finalId, name: modName, modname,
          url: href.startsWith('http') ? href : `${LMS_URL}${href}`,
          visible: 1,
        });
      }
    }

    return sectionPositions.map(s => ({
      id: s.num,
      name: s.name,
      visible: 1,
      summary: '',
      section: s.num,
      modules: modulesBySection.get(s.num) || [],
    }));
  }

  async search(query: string): Promise<Course[]> {
    const result = await this.api.callSingle('core_course_search_courses', {
      criterianame: 'search',
      criteriavalue: query,
    }) as { courses: Course[] };
    return result.courses || [];
  }

  async getRecent(): Promise<Course[]> {
    const items = await this.api.callSingle('block_recentlyaccesseditems_get_recent_items') as Array<{
      cmid: number;
      courseid: number;
      name: string;
    }>;
    const courseIds = [...new Set(items.map(i => i.courseid))];
    const allCourses = await this.getAll();
    return allCourses.filter(c => courseIds.includes(c.id));
  }
}
