# TSU MCP

MCP-сервер для работы с сервисами Томского государственного университета (ТГУ).

## Сервисы

- **LMS TSU** (`lms.tsu.ru`) — курсы, задания, викторины, файлы, сообщения, уведомления, календарь
- **Intime** (`intime.tsu.ru`) — расписание, факультеты, группы, преподаватели, аудитории, корпуса
- **Личный кабинет** (`lk.student.tsu.ru`) — профиль, успеваемость по семестрам, академические задолженности

## Инструменты (tools)

### Курсы

| Tool | Описание |
|------|----------|
| `get_courses` | Все курсы текущего пользователя |
| `get_course` | Детали конкретного курса |
| `get_course_contents` | Содержание/разделы курса |
| `search_courses` | Поиск курсов |
| `get_recent_courses` | Недавно открытые курсы |

### Задания

| Tool | Описание |
|------|----------|
| `list_assignments` | Список заданий в курсе |
| `get_assignment` | Детали задания |
| `get_assignment_submissions` | Сдачи задания (преподаватель) |
| `upload_file` | Загрузить файл к заданию |
| `submit_assignment` | Отправить задание на проверку |
| `get_assignment_status` | Статус сдачи заданий в курсе |

### Викторины

| Tool | Описание |
|------|----------|
| `list_quizzes` | Список викторин в курсе |
| `get_quiz` | Детали викторины |
| `get_quiz_attempts` | Попытки прохождения |

### Файлы

| Tool | Описание |
|------|----------|
| `list_files` | Файлы/ресурсы в курсе |
| `get_file` | Скачать файл по URL |
| `list_folder_contents` | Содержимое папки |

### Сообщения и уведомления

| Tool | Описание |
|------|----------|
| `get_conversations` | Список бесед |
| `get_messages` | Сообщения в беседе |
| `send_message` | Отправить сообщение |
| `get_notifications` | Уведомления |

### Календарь

| Tool | Описание |
|------|----------|
| `get_events` | События за период |
| `get_upcoming_events` | Ближайшие события (неделя) |

### Intime — Расписание

| Tool | Описание |
|------|----------|
| `intime_get_faculties` | Все факультеты |
| `intime_get_faculty_groups` | Группы факультета |
| `intime_get_schedule` | Расписание группы |
| `intime_get_professors` | Поиск преподавателей |
| `intime_get_professor_schedule` | Расписание преподавателя |
| `intime_get_buildings` | Все корпуса |
| `intime_get_audience_schedule` | Расписание аудитории |

### Личный кабинет

| Tool | Описание |
|------|----------|
| `lk_get_profile` | Профиль студента |
| `lk_get_attestations` | Успеваемость по семестрам |
| `lk_get_debts` | Академические задолженности |

## Установка

### 1. Клонировать и собрать

```bash
git clone https://github.com/AsmanovLev/tsu-mcp.git
cd tsu-mcp
npm install
npm run build
```

### 2. Настроить креды

Скопируйте шаблон и впишите свои данные:

```bash
cp .env.example .env
```

`.env`:
```
TSU_EMAIL=ваш_email@tsu.ru
TSU_PASSWORD=ваш_пароль
```

### 3. Запуск

```bash
npm start
```

## Подключение к opencode

Добавьте в `opencode.json` в секцию `mcp`:

```json
"university": {
  "type": "local",
  "command": ["node", "/path/to/tsu-mcp/build/index.js"],
  "enabled": true
}
```

## Стек

- TypeScript
- Node.js
- `@modelcontextprotocol/sdk`
- Axios
