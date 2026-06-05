import * as fs from 'fs';
import * as path from 'path';

export interface SessionData {
  cookies: Record<string, string>;
  sesskey: string;
  userid: number;
  expires: string;
}

const SESSION_FILE = path.resolve(__dirname, 'session.json');

export function loadSession(): SessionData | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = fs.readFileSync(SESSION_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    console.error('Failed to load session file');
  }
  return null;
}

export function saveSession(session: SessionData): void {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
  } catch {
    console.error('Failed to save session file');
  }
}

export function clearSession(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch {
    console.error('Failed to clear session file');
  }
}

export function isSessionExpired(session: SessionData): boolean {
  return new Date(session.expires).getTime() <= Date.now();
}
