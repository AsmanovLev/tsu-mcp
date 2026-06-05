import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Auth } from './auth';
import { MoodleAPI } from './api';
import { Courses } from './courses';
import { Assignments } from './assignments';
import { Files } from './files';
import { IntimeAPI } from './intime';
import { LkStudentAPI } from './lkstudent';

const EMAIL: string = process.env.TSU_EMAIL as string;
const PASSWORD: string = process.env.TSU_PASSWORD as string;

if (!EMAIL || !PASSWORD) {
  console.error('Missing TSU_EMAIL or TSU_PASSWORD in environment');
  process.exit(1);
}

const auth = new Auth();
const api = new MoodleAPI(auth);
const courses = new Courses(api, auth);
const assignments = new Assignments(auth, api);
const files = new Files(auth);
const intime = new IntimeAPI();
const lkstudent = new LkStudentAPI(auth);

const server = new Server(
  { name: 'tsu-mcp', version: '2.0.0' },
  { capabilities: { tools: {} } },
);

const TOOLS: Tool[] = [
  {
    name: 'get_courses',
    description: 'Get all courses for the current user',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_course',
    description: 'Get details of a specific course',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'number', description: 'Course ID' },
      },
      required: ['courseId'],
    },
  },
  {
    name: 'get_course_contents',
    description: 'Get the contents/sections of a course',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'number', description: 'Course ID' },
      },
      required: ['courseId'],
    },
  },
  {
    name: 'search_courses',
    description: 'Search for courses by query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_recent_courses',
    description: 'Get recently accessed courses',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_assignments',
    description: 'List all assignments in a course',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'number', description: 'Course ID' },
      },
      required: ['courseId'],
    },
  },
  {
    name: 'get_assignment',
    description: 'Get details of a specific assignment',
    inputSchema: {
      type: 'object',
      properties: {
        assignmentId: { type: 'number', description: 'Assignment ID' },
      },
      required: ['assignmentId'],
    },
  },
  {
    name: 'get_assignment_submissions',
    description: 'Get submissions for an assignment (teacher)',
    inputSchema: {
      type: 'object',
      properties: {
        assignmentId: { type: 'number', description: 'Assignment ID' },
      },
      required: ['assignmentId'],
    },
  },
  {
    name: 'upload_file',
    description: 'Upload a file to an assignment',
    inputSchema: {
      type: 'object',
      properties: {
        assignmentId: { type: 'number', description: 'Assignment ID' },
        filePath: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['assignmentId', 'filePath'],
    },
  },
  {
    name: 'submit_assignment',
    description: 'Submit an assignment for grading',
    inputSchema: {
      type: 'object',
      properties: {
        assignmentId: { type: 'number', description: 'Assignment ID' },
      },
      required: ['assignmentId'],
    },
  },
  {
    name: 'get_assignment_status',
    description: 'Check submission status for all assignments in a course',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'number', description: 'Course ID' },
      },
      required: ['courseId'],
    },
  },
  {
    name: 'list_quizzes',
    description: 'List all quizzes in a course',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'number', description: 'Course ID' },
      },
      required: ['courseId'],
    },
  },
  {
    name: 'get_quiz',
    description: 'Get details of a specific quiz',
    inputSchema: {
      type: 'object',
      properties: {
        quizId: { type: 'number', description: 'Quiz ID' },
      },
      required: ['quizId'],
    },
  },
  {
    name: 'get_quiz_attempts',
    description: 'Get attempts for a quiz',
    inputSchema: {
      type: 'object',
      properties: {
        quizId: { type: 'number', description: 'Quiz ID' },
      },
      required: ['quizId'],
    },
  },
  {
    name: 'get_conversations',
    description: 'Get all conversations',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_messages',
    description: 'Get messages in a conversation',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'number', description: 'Conversation ID' },
      },
      required: ['conversationId'],
    },
  },
  {
    name: 'send_message',
    description: 'Send a message in a conversation',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'number', description: 'Conversation ID' },
        text: { type: 'string', description: 'Message text' },
      },
      required: ['conversationId', 'text'],
    },
  },
  {
    name: 'get_notifications',
    description: 'Get all notifications',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_events',
    description: 'Get calendar events in a time range',
    inputSchema: {
      type: 'object',
      properties: {
        timefrom: { type: 'number', description: 'Start timestamp' },
        timeto: { type: 'number', description: 'End timestamp' },
      },
      required: ['timefrom', 'timeto'],
    },
  },
  {
    name: 'get_upcoming_events',
    description: 'Get upcoming calendar events',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_files',
    description: 'List files/resources in a course',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'number', description: 'Course ID' },
      },
      required: ['courseId'],
    },
  },
  {
    name: 'get_file',
    description: 'Download a file from a URL',
    inputSchema: {
      type: 'object',
      properties: {
        fileUrl: { type: 'string', description: 'File URL' },
        outputPath: { type: 'string', description: 'Output path to save the file' },
      },
      required: ['fileUrl', 'outputPath'],
    },
  },
  {
    name: 'list_folder_contents',
    description: 'List files inside a folder in a course',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: { type: 'number', description: 'Folder module ID (from list_files)' },
      },
      required: ['folderId'],
    },
  },
  // --- Intime Tools ---
  {
    name: 'intime_get_faculties',
    description: 'Get all faculties from Intime',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'intime_get_faculty_groups',
    description: 'Get groups of a faculty from Intime',
    inputSchema: {
      type: 'object',
      properties: {
        facultyId: { type: 'string', description: 'Faculty ID' },
      },
      required: ['facultyId'],
    },
  },
  {
    name: 'intime_get_schedule',
    description: 'Get schedule for a group from Intime',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Group ID' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD, optional)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD, optional)' },
      },
      required: ['groupId'],
    },
  },
  {
    name: 'intime_get_professors',
    description: 'Search professors from Intime',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search query (optional)' },
      },
    },
  },
  {
    name: 'intime_get_buildings',
    description: 'Get all buildings (корпуса) from Intime',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'intime_get_professor_schedule',
    description: 'Get schedule for a professor from Intime',
    inputSchema: {
      type: 'object',
      properties: {
        professorId: { type: 'string', description: 'Professor ID' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD, optional)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD, optional)' },
      },
      required: ['professorId'],
    },
  },
  {
    name: 'intime_get_audience_schedule',
    description: 'Get schedule for an audience from Intime',
    inputSchema: {
      type: 'object',
      properties: {
        audienceId: { type: 'string', description: 'Audience ID' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD, optional)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD, optional)' },
      },
      required: ['audienceId'],
    },
  },
  // --- LkStudent Tools ---
  {
    name: 'lk_get_profile',
    description: 'Get student profile from LK Student',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lk_get_debts',
    description: 'Get academic debts (академические задолженности)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lk_get_attestations',
    description: 'Get attestation/semester grades (успеваемость по семестрам)',
    inputSchema: { type: 'object', properties: {} },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    await auth.ensureAuth(EMAIL, PASSWORD);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Authentication failed: ${message}` }],
      isError: true,
    };
  }

  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // --- Courses ---
      case 'get_courses': {
        const result = await courses.getAll();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_course': {
        const { courseId } = args as { courseId: number };
        const result = await courses.getById(courseId);
        if (!result) throw new Error(`Course ${courseId} not found`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_course_contents': {
        const { courseId } = args as { courseId: number };
        const result = await courses.getContents(courseId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'search_courses': {
        const { query } = args as { query: string };
        const result = await courses.search(query);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_recent_courses': {
        const result = await courses.getRecent();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // --- Assignments ---
      case 'list_assignments': {
        const { courseId } = args as { courseId: number };
        const result = await assignments.listByCourse(courseId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_assignment': {
        const { assignmentId } = args as { assignmentId: number };
        const result = await assignments.getById(assignmentId);
        if (!result) throw new Error(`Assignment ${assignmentId} not found`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_assignment_submissions': {
        const { assignmentId } = args as { assignmentId: number };
        const result = await assignments.getSubmissions(assignmentId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'upload_file': {
        const { assignmentId, filePath } = args as { assignmentId: number; filePath: string };
        const result = await assignments.uploadFile(assignmentId, filePath);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'submit_assignment': {
        const { assignmentId } = args as { assignmentId: number };
        await assignments.submit(assignmentId);
        return { content: [{ type: 'text', text: `Assignment ${assignmentId} submitted successfully` }] };
      }
      case 'get_assignment_status': {
        const { courseId } = args as { courseId: number };
        const result = await assignments.getByCourseWithStatus(courseId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // --- Quizzes ---
      case 'list_quizzes': {
        const { courseId } = args as { courseId: number };
        const contents = await courses.getContents(courseId);
        const quizzes = [];
        for (const section of contents) {
          for (const mod of section.modules) {
            if (mod.modname === 'quiz') {
              quizzes.push(mod);
            }
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(quizzes, null, 2) }] };
      }
      case 'get_quiz': {
        const { quizId } = args as { quizId: number };
        const result = await api.callSingle('mod_quiz_get_quiz_by_id', { quizid: quizId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_quiz_attempts': {
        const { quizId } = args as { quizId: number };
        const result = await api.callSingle('mod_quiz_get_user_attempts', { quizid: quizId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // --- Messages ---
      case 'get_conversations': {
        const result = await api.callSingle('core_message_get_conversations', { userid: 0 });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_messages': {
        const { conversationId } = args as { conversationId: number };
        const result = await api.callSingle('core_message_get_conversation_messages', {
          conversationid: conversationId,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'send_message': {
        const { conversationId, text } = args as { conversationId: number; text: string };
        const session = auth.getSession();
        if (!session) throw new Error('Not authenticated');
        const result = await api.callSingle('core_message_send_messages_to_conversation', {
          conversationid: conversationId,
          messages: [{ text, clientmsgid: Date.now().toString() }],
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // --- Notifications ---
      case 'get_notifications': {
        const result = await api.callSingle('message_popup_get_popup_notifications', {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // --- Calendar ---
      case 'get_events': {
        const { timefrom, timeto } = args as { timefrom: number; timeto: number };
        const result = await api.callSingle('core_calendar_get_action_events_by_timesort', {
          timesortfrom: timefrom,
          timesortto: timeto,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_upcoming_events': {
        const now = Math.floor(Date.now() / 1000);
        const week = 7 * 24 * 60 * 60;
        const result = await api.callSingle('core_calendar_get_action_events_by_timesort', {
          timesortfrom: now,
          timesortto: now + week,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // --- Files ---
      case 'list_files': {
        const { courseId } = args as { courseId: number };
        const contents = await courses.getContents(courseId);
        const result: Array<{ name: string; url: string; type: string; modId: number }> = [];
        for (const section of contents) {
          for (const mod of section.modules) {
            if (['resource', 'folder', 'url'].includes(mod.modname)) {
              result.push({ name: mod.name, url: mod.url || '', type: mod.modname, modId: mod.id });
            }
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_file': {
        const { fileUrl, outputPath } = args as { fileUrl: string; outputPath: string };
        const result = await files.download(fileUrl, outputPath);
        return { content: [{ type: 'text', text: `File saved to ${result}` }] };
      }
      case 'list_folder_contents': {
        const { folderId } = args as { folderId: number };
        const result = await files.listFolderContents(folderId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // --- Intime ---
      case 'intime_get_faculties': {
        const faculties = await intime.getFaculties();
        return { content: [{ type: 'text', text: JSON.stringify(faculties, null, 2) }] };
      }
      case 'intime_get_faculty_groups': {
        const { facultyId } = args as { facultyId: string };
        const groups = await intime.getFacultyGroups(facultyId);
        return { content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }] };
      }
      case 'intime_get_schedule': {
        const { groupId, dateFrom, dateTo } = args as { groupId: string; dateFrom?: string; dateTo?: string };
        const schedule = await intime.getGroupSchedule(groupId, dateFrom, dateTo);
        return { content: [{ type: 'text', text: JSON.stringify(schedule, null, 2) }] };
      }

      case 'intime_get_professors': {
        const { search } = args as { search?: string };
        const profs = await intime.getProfessors(search);
        return { content: [{ type: 'text', text: JSON.stringify(profs, null, 2) }] };
      }
      case 'intime_get_buildings': {
        const auds = await intime.getBuildings();
        return { content: [{ type: 'text', text: JSON.stringify(auds, null, 2) }] };
      }
      case 'intime_get_professor_schedule': {
        const { professorId, dateFrom, dateTo } = args as { professorId: string; dateFrom?: string; dateTo?: string };
        const ps = await intime.getProfessorSchedule(professorId, dateFrom, dateTo);
        return { content: [{ type: 'text', text: JSON.stringify(ps, null, 2) }] };
      }
      case 'intime_get_audience_schedule': {
        const { audienceId, dateFrom, dateTo } = args as { audienceId: string; dateFrom?: string; dateTo?: string };
        const as = await intime.getAudienceSchedule(audienceId, dateFrom, dateTo);
        return { content: [{ type: 'text', text: JSON.stringify(as, null, 2) }] };
      }

      // --- LK Student ---
      case 'lk_get_profile': {
        const prof = await lkstudent.getProfile();
        return { content: [{ type: 'text', text: JSON.stringify(prof, null, 2) }] };
      }
      case 'lk_get_debts': {
        const debts = await lkstudent.getDebts();
        return { content: [{ type: 'text', text: JSON.stringify(debts, null, 2) }] };
      }
      case 'lk_get_attestations': {
        const attestations = await lkstudent.getAttestations();
        return { content: [{ type: 'text', text: JSON.stringify(attestations, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  try {
    await auth.login(EMAIL, PASSWORD);
    console.error('Authenticated successfully');
  } catch (err: unknown) {
    console.error('Initial auth failed, will retry on first request:', err instanceof Error ? err.message : String(err));
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('tsu-mcp server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
