import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { Auth } from './auth';
import { MoodleAPI } from './api';
import * as FormData from 'form-data';

const LMS_URL = 'https://lms.tsu.ru';
const ASSIGN_VIEW = '/mod/assign/view.php';

const MSK_OFFSET = 3 * 3600;

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const local = ts + 7 * 3600;
  const d = new Date(local * 1000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${mi} UTC+7`;
}

export interface Assignment {
  id: number;
  cmid: number;
  course: number;
  name: string;
  intro: string;
  duedate: number;
  allowsubmissionsfromdate: number;
  grade: number;
  duedateStr: string;
  opensStr: string;
}

export interface AssignmentSubmission {
  id: number;
  userid: number;
  timemodified: number;
  status: string;
  groupid: number;
  attempts: number;
}

export class Assignments {
  private auth: Auth;
  private api: MoodleAPI;

  constructor(auth: Auth, api: MoodleAPI) {
    this.auth = auth;
    this.api = api;
  }

  async listByCourse(courseId: number): Promise<Assignment[]> {
    try {
      const assignInfo = await this.api.callSingle('mod_assign_get_assignments', {
        courseids: [courseId],
      }) as { courses: Array<{ assignments: Assignment[] }> };
      return assignInfo.courses?.[0]?.assignments || [];
    } catch {
      return this.scrapeAssignmentsByCourse(courseId);
    }
  }

  private async scrapeAssignmentsByCourse(courseId: number): Promise<Assignment[]> {
    const resp = await this.auth.getClient().get(`${LMS_URL}/course/view.php?id=${courseId}`);
    const html = typeof resp.data === 'string' ? resp.data : '';
    const assignments: Assignment[] = [];

    const re = /modtype_assign[^"]*"[^>]*id="module-(\d+)"[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>\s*<span class="instancename">([\s\S]*?)<\/span>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      const cmid = parseInt(match[1], 10);
      const name = match[3].replace(/<[^>]+>/g, '').replace(/\s+Задание\s*$/, '').trim();
      assignments.push({
        id: cmid,
        cmid,
        course: courseId,
        name,
        intro: '',
        duedate: 0,
        allowsubmissionsfromdate: 0,
        grade: 0,
        duedateStr: '',
        opensStr: '',
      });
    }

    const detailed = await Promise.all(
      assignments.map(a => this.scrapeAssignmentDetail(a.cmid).then(d => ({ ...a, ...d })))
    );
    return detailed;
  }

  private parseRussianDate(dateStr: string): number {
    const months: Record<string, number> = {
      'январ': 1, 'феврал': 2, 'март': 3, 'апрел': 4,
      'ма': 5, 'июн': 6, 'июл': 7, 'август': 8,
      'сентябр': 9, 'октябр': 10, 'ноябр': 11, 'декабр': 12,
    };
    const cleaned = dateStr.replace(/[а-яА-Я]+,?\s*/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [prefix, num] of Object.entries(months)) {
      if (dateStr.toLowerCase().includes(prefix)) {
        const m = cleaned.match(/(\d{1,2})\s+(\d{4})\s*,?\s*(\d{1,2}):(\d{2})/);
        if (m) {
          return Math.floor(Date.UTC(parseInt(m[2]), num - 1, parseInt(m[1]), parseInt(m[3]), parseInt(m[4])) / 1000) - MSK_OFFSET;
        }
        const m2 = cleaned.match(/(\d{1,2})\s+(\d{4})/);
        if (m2) {
          return Math.floor(Date.UTC(parseInt(m2[2]), num - 1, parseInt(m2[1])) / 1000) - MSK_OFFSET;
        }
      }
    }
    return 0;
  }

  private async scrapeAssignmentDetail(cmid: number): Promise<Partial<Assignment>> {
    try {
      const resp = await this.auth.getClient().get(`${LMS_URL}/mod/assign/view.php?id=${cmid}`);
      const html = typeof resp.data === 'string' ? resp.data : '';
      console.error(`[scrapeDetail] cmid=${cmid} htmlLen=${html.length}`);
      const result: Partial<Assignment> = {};

      const datesection = html.match(/data-region="activity-dates"[\s\S]*?<\/div>\s*<\/div>/i);
      console.error(`[scrapeDetail] datesection=${!!datesection}`);
      if (datesection) {
        const openMatch = datesection[0].match(/Открыто с:<\/strong>\s*([^<]+)/i)
          || datesection[0].match(/Opens:<\/strong>\s*([^<]+)/i);
        if (openMatch) {
          result.allowsubmissionsfromdate = this.parseRussianDate(openMatch[1]);
        }

        const dueMatch = datesection[0].match(/Срок сдачи:<\/strong>\s*([^<]+)/i)
          || datesection[0].match(/Due date:<\/strong>\s*([^<]+)/i)
          || datesection[0].match(/Срок здачі:<\/strong>\s*([^<]+)/i);
        if (dueMatch) {
          result.duedate = this.parseRussianDate(dueMatch[1]);
        }
      }

      const midnightMatch = html.match(/data-midnight="(\d+)"/);
      if (midnightMatch && !result.duedate) {
        result.duedate = parseInt(midnightMatch[1], 10);
      }

      const introMatch = html.match(/class="activity-description"[^>]*id="intro"[\s\S]*?<div[^>]*class="box[^"]*"[^>]*><div[^>]*class="no-overflow">([\s\S]*?)<\/div>/i);
      if (introMatch) {
        result.intro = introMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }

      const gradeMatch = html.match(/(?:Максимальный балл|Maximum grade|Максимальний балл|максимальное количество баллов)[:\s]*(\d+)/i);
      if (gradeMatch) {
        result.grade = parseInt(gradeMatch[1], 10);
      }

      if (result.duedate) result.duedateStr = formatTimestamp(result.duedate);
      if (result.allowsubmissionsfromdate) result.opensStr = formatTimestamp(result.allowsubmissionsfromdate);

      console.error(`[scrapeDetail] result:`, JSON.stringify(result));
      return result;
    } catch (e) {
      console.error(`[scrapeDetail] ERROR for cmid=${cmid}:`, e);
      return {};
    }
  }

  async getById(assignmentId: number): Promise<Assignment | null> {
    // Try API first with valid course IDs
    try {
      const coursesResp = await this.api.callSingle('core_course_get_recent_courses', {
        userid: 0, limit: 100, offset: 0,
      }) as Array<{ id: number }> | { data: Array<{ id: number }> };

      const courseList = Array.isArray(coursesResp) ? coursesResp : (coursesResp?.data || []);
      const courseIds = courseList.map(c => c.id);

      if (courseIds.length > 0) {
        const result = await this.api.callSingle('mod_assign_get_assignments', {
          courseids: courseIds,
        }) as { courses: Array<{ assignments: Assignment[] }> };

        for (const course of result.courses || []) {
          for (const a of course.assignments || []) {
            if (a.id === assignmentId) return a;
          }
        }
      }
    } catch {
      // API failed, fall back to scraping
    }

    // Fallback: scrape all courses for this assignment
    return this.scrapeGetById(assignmentId);
  }

  private async scrapeGetById(assignmentId: number): Promise<Assignment | null> {
    const coursesResp = await this.api.callSingle('core_course_get_recent_courses', {
      userid: 0, limit: 100, offset: 0,
    }).catch(() => []) as Array<{ id: number }> | { data: Array<{ id: number }> };

    const courseList = Array.isArray(coursesResp) ? coursesResp : (coursesResp?.data || []);

    for (const course of courseList) {
      const resp = await this.auth.getClient().get(`${LMS_URL}/course/view.php?id=${course.id}`);
      const html = typeof resp.data === 'string' ? resp.data : '';
      const re = /modtype_assign[^"]*"[^>]*id="module-(\d+)"[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>\s*<span class="instancename">([\s\S]*?)<\/span>/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(html)) !== null) {
        const cmid = parseInt(match[1], 10);
        if (cmid === assignmentId || cmid === assignmentId) {
          const name = match[3].replace(/<[^>]+>/g, '').replace(/\s+Задание\s*$/, '').trim();
          const base: Assignment = {
            id: cmid, cmid, course: course.id, name,
            intro: '', duedate: 0, allowsubmissionsfromdate: 0, grade: 0,
            duedateStr: '', opensStr: '',
          };
          const detail = await this.scrapeAssignmentDetail(cmid);
          return { ...base, ...detail };
        }
      }
    }
    return null;
  }

  async getSubmissions(assignmentId: number): Promise<AssignmentSubmission[]> {
    const raw = await this.api.callSingle('mod_assign_get_submissions', {
      assignmentids: [assignmentId],
    });
    console.error(`[tsu-mcp] getSubmissions raw response for assignment ${assignmentId}:`, JSON.stringify(raw).slice(0, 500));
    const result = raw as { submissions: Array<{ submission: AssignmentSubmission }> };

    return (result.submissions || []).map(s => s.submission);
  }

  async getByCourseWithStatus(courseId: number): Promise<Array<{
    id: number; name: string; status: string;
    grade: number | null; duedate: string; submissionDate: string | null;
  }>> {
    const assignments = await this.listByCourse(courseId);
    const session = this.auth.getSession();
    const userId = session?.userid || 0;
    const results: Array<{
      id: number; name: string; status: string;
      grade: number | null; duedate: string; submissionDate: string | null;
    }> = [];

    for (const assignment of assignments) {
      try {
        const submissions = await this.getSubmissions(assignment.id);
        const userSub = userId
          ? submissions.find(s => s.userid === userId)
          : submissions[0];

        let status = 'not_submitted';
        let grade: number | null = null;
        let submissionDate: string | null = null;

        if (userSub) {
          status = userSub.status || 'unknown';
          grade = (userSub as any).grade ?? null;
          submissionDate = userSub.timemodified
            ? new Date(userSub.timemodified * 1000).toISOString()
            : null;
        }

        if (grade !== null && grade >= 0) {
          status = 'graded';
        }

        results.push({
          id: assignment.id,
          name: assignment.name,
          status,
          grade,
          duedate: assignment.duedateStr,
          submissionDate,
        });
      } catch (e: any) {
        console.error(`[tsu-mcp] getSubmissions error for assignment ${assignment.id} (${assignment.name}):`, e?.message || e);
        results.push({
          id: assignment.id,
          name: assignment.name,
          status: 'error',
          grade: null,
          duedate: assignment.duedateStr,
          submissionDate: null,
        });
      }
    }

    return results;
  }

  async uploadFile(
    assignmentId: number,
    filePath: string,
  ): Promise<{ itemid: number; filename: string }> {
    const session = this.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const editUrl = `${LMS_URL}${ASSIGN_VIEW}?id=${assignmentId}&action=editsubmission`;

    const editResp = await this.auth.getClient().get(editUrl);
    const html = typeof editResp.data === 'string' ? editResp.data : '';

    const itemidMatch = html.match(/itemid\s*:\s*(\d+)/);
    if (!itemidMatch) throw new Error('Could not extract itemid from editsubmission page');

    const itemid = parseInt(itemidMatch[1], 10);
    const filename = path.basename(filePath);

    const uploadUrl = `${LMS_URL}/repository/draftfiles_ajax.php?action=upload`;

    const form = new FormData.default();
    form.append('repo_upload_file', fs.createReadStream(filePath), filename);
    form.append('title', filename);
    form.append('sesskey', session.sesskey);
    form.append('itemid', String(itemid));
    form.append('course', '0');
    form.append('ctx_id', '0');

    await this.auth.getClient().post(uploadUrl, form, {
      headers: {
        ...form.getHeaders(),
      },
    });

    return { itemid, filename };
  }

  async submit(assignmentId: number): Promise<void> {
    const session = this.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const submitUrl = `${LMS_URL}${ASSIGN_VIEW}`;
    const formData = new URLSearchParams();
    formData.append('id', String(assignmentId));
    formData.append('action', 'savesubmission');
    formData.append('sesskey', session.sesskey);

    await this.auth.getClient().post(submitUrl, formData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }
}
