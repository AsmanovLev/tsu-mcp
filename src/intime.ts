import axios, { AxiosInstance } from 'axios';

const INTIME_URL = 'https://intime.tsu.ru';

export interface Faculty {
  id: string;
  name: string;
  avatar: string;
  color: string;
  darkColor: string;
}

export interface Group {
  id: string;
  name: string;
  isSubgroup: boolean;
  facultyId: string;
}

export interface Professor {
  id: string;
  fullName: string;
}

export interface Audience {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  image: string;
}

export interface Lesson {
  type: string;
  id?: string;
  title?: string;
  lessonType?: string;
  groups?: Array<{ id: string; name: string; isSubgroup: boolean; facultyId: string }>;
  professor?: { id: string; fullName: string } | null;
  audience?: {
    id: string | null;
    name: string | null;
    shortName: string | null;
    building: { id: string; name: string; address: string; latitude: number; longitude: number } | null;
  } | null;
  lessonNumber: number;
  starts: number;
  ends: number;
}

export interface DaySchedule {
  date: string;
  lessons: Lesson[];
}

export interface ScheduleGrid {
  grid: DaySchedule[];
  groups: unknown[];
  professors: unknown[];
  audiences: unknown[];
  hash: string;
}

export class IntimeAPI {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: INTIME_URL,
      timeout: 15000,
    });
  }

  /**
   * API расписания отвечает 404, если не передать ОБА конца периода.
   * Схема инструментов объявляет их необязательными, поэтому подставляем
   * окно «сегодня .. +6 дней», когда даты не заданы.
   */
  private resolveRange(dateFrom?: string, dateTo?: string): { dateFrom: string; dateTo: string } {
    const fmt = (d: Date): string => d.toISOString().slice(0, 10);
    const from = dateFrom ? new Date(dateFrom) : new Date();
    const to = dateTo ? new Date(dateTo) : new Date(from.getTime() + 6 * 24 * 60 * 60 * 1000);
    return { dateFrom: dateFrom || fmt(from), dateTo: dateTo || fmt(to) };
  }

  async getFaculties(): Promise<Faculty[]> {
    const resp = await this.client.get('/api/web/v1/faculties');
    return resp.data;
  }

  async getFacultyGroups(facultyId: string): Promise<Group[]> {
    const resp = await this.client.get(`/api/web/v1/faculties/${facultyId}/groups`);
    return resp.data;
  }

  async getGroupSchedule(groupId: string, dateFrom?: string, dateTo?: string): Promise<ScheduleGrid> {
    const range = this.resolveRange(dateFrom, dateTo);
    const params: Record<string, string> = { id: groupId, ...range };
    const resp = await this.client.get('/api/web/v1/schedule/group', { params });
    return resp.data;
  }

  async getProfessors(search?: string): Promise<Professor[]> {
    const resp = await this.client.get('/api/web/v1/professors');
    const all = resp.data as Professor[];
    if (search) {
      const q = search.toLowerCase();
      return all.filter(p => p.fullName.toLowerCase().includes(q));
    }
    return all;
  }

  async getBuildings(): Promise<Audience[]> {
    const resp = await this.client.get('/api/web/v1/buildings');
    return resp.data;
  }

  async getProfessorSchedule(professorId: string, dateFrom?: string, dateTo?: string): Promise<ScheduleGrid> {
    const range = this.resolveRange(dateFrom, dateTo);
    const params: Record<string, string> = { id: professorId, ...range };
    const resp = await this.client.get('/api/web/v1/schedule/professor', { params });
    return resp.data;
  }

  async getAudienceSchedule(audienceId: string, dateFrom?: string, dateTo?: string): Promise<ScheduleGrid> {
    const range = this.resolveRange(dateFrom, dateTo);
    const params: Record<string, string> = { id: audienceId, ...range };
    const resp = await this.client.get('/api/web/v1/schedule/audience', { params });
    return resp.data;
  }
}
