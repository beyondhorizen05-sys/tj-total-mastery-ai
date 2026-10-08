import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';

export class EducationError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type Resource = { label: string; url: string };
export type Lesson = { id: string; plan_id: string; title: string; content: string; resources: Resource[]; status: 'not_started' | 'in_progress' | 'completed'; created_at: string; updated_at: string; question_count: number; attempt_count: number; best_percent: number | null };
export type Plan = { id: string; title: string; goal: string; created_at: string; updated_at: string; lesson_count: number; completed_count: number; progress_percent: number };
export type QuizQuestion = { id: string; lesson_id: string; kind: 'multiple_choice' | 'recall'; prompt: string; options: string[]; created_at: string };
export type QuizResult = { question_id: string; prompt: string; kind: QuizQuestion['kind']; answer: string | number | null; correct: boolean; correct_answer: string | number };
export type QuizAttempt = { id: string; lesson_id: string; correct_count: number; total_count: number; percent: number; results: QuizResult[]; created_at: string };

const timestamp = () => new Date().toISOString();
const id = () => randomUUID();

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new EducationError(`${label} must contain 1 to ${max} characters.`);
  return value.trim();
}
function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new EducationError(`${label} must be text up to ${max} characters.`);
  return value.trim();
}
const normalizeRecall = (answer: string) => answer.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Local education records. Lesson content is supplied by the user; no generated material is implied. */
export class EducationService {
  constructor(private db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS education_plans (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS education_lessons (
      id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES education_plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL, content TEXT NOT NULL, resources TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_education_lessons_plan ON education_lessons(plan_id)');
    db.exec(`CREATE TABLE IF NOT EXISTS education_questions (
      id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES education_lessons(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, prompt TEXT NOT NULL, options TEXT NOT NULL, correct_answer TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_education_questions_lesson ON education_questions(lesson_id)');
    db.exec(`CREATE TABLE IF NOT EXISTS education_attempts (
      id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES education_lessons(id) ON DELETE CASCADE,
      correct_count INTEGER NOT NULL, total_count INTEGER NOT NULL, percent INTEGER NOT NULL,
      results TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_education_attempts_lesson ON education_attempts(lesson_id, created_at)');
  }

  listPlans(): Plan[] {
    const rows = this.db.all<Plan & { lesson_count: number; completed_count: number }>(`SELECT p.*,
      COUNT(l.id) AS lesson_count,
      SUM(CASE WHEN l.status = 'completed' THEN 1 ELSE 0 END) AS completed_count
      FROM education_plans p LEFT JOIN education_lessons l ON l.plan_id = p.id
      GROUP BY p.id ORDER BY p.created_at DESC`);
    return rows.map((row) => ({ ...row, completed_count: row.completed_count ?? 0, progress_percent: row.lesson_count ? Math.round((row.completed_count ?? 0) / row.lesson_count * 100) : 0 }));
  }

  getPlan(planId: string): { plan: Plan; lessons: Lesson[] } {
    const plan = this.listPlans().find((item) => item.id === planId);
    if (!plan) throw new EducationError('Study plan not found.', 404);
    const rows = this.db.all<any>(`SELECT l.*, (SELECT COUNT(*) FROM education_questions q WHERE q.lesson_id=l.id) AS question_count,
      (SELECT COUNT(*) FROM education_attempts a WHERE a.lesson_id=l.id) AS attempt_count,
      (SELECT MAX(percent) FROM education_attempts a WHERE a.lesson_id=l.id
        AND a.total_count=(SELECT COUNT(*) FROM education_questions q WHERE q.lesson_id=l.id)) AS best_percent
      FROM education_lessons l WHERE l.plan_id=? ORDER BY l.created_at, l.rowid`, [planId]);
    return { plan, lessons: rows.map((row) => ({ ...row, resources: JSON.parse(row.resources) as Resource[] })) };
  }

  createPlan(input: { title: unknown; goal?: unknown }): Plan {
    const title = requiredText(input.title, 'Plan title', 140);
    const goal = optionalText(input.goal, 'Goal', 500);
    if ((this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM education_plans')?.count ?? 0) >= 100) throw new EducationError('Study plan limit of 100 reached.', 409);
    const key = id(), time = timestamp();
    this.db.run('INSERT INTO education_plans (id,title,goal,created_at,updated_at) VALUES (?,?,?,?,?)', [key, title, goal, time, time]);
    return this.getPlan(key).plan;
  }

  deletePlan(planId: string): void {
    const result = this.db.run('DELETE FROM education_plans WHERE id=?', [planId]);
    if (result.changes === 0) throw new EducationError('Study plan not found.', 404);
  }

  createLesson(planId: string, input: { title: unknown; content?: unknown; resources?: unknown }): Lesson {
    this.getPlan(planId);
    const title = requiredText(input.title, 'Lesson title', 140);
    const content = optionalText(input.content, 'Lesson content', 30_000);
    const suppliedResources = input.resources ?? [];
    if (!Array.isArray(suppliedResources) || suppliedResources.length > 10) throw new EducationError('Lesson resources must be an array of up to 10 links.');
    const resources: Resource[] = suppliedResources.map((item) => {
      if (!item || typeof item !== 'object') throw new EducationError('Each resource needs a label and URL.');
      const record = item as Record<string, unknown>;
      const label = requiredText(record.label, 'Resource label', 120);
      if (typeof record.url !== 'string' || record.url.length > 2000) throw new EducationError('Resource URL is invalid.');
      let url: URL;
      try { url = new URL(record.url); } catch { throw new EducationError('Resource URL is invalid.'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new EducationError('Resource URL must use HTTP or HTTPS.');
      return { label, url: url.toString() };
    });
    if ((this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM education_lessons WHERE plan_id=?', [planId])?.count ?? 0) >= 200) throw new EducationError('Lesson limit of 200 per plan reached.', 409);
    const key = id(), time = timestamp();
    this.db.run('INSERT INTO education_lessons (id,plan_id,title,content,resources,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [key, planId, title, content, JSON.stringify(resources), 'not_started', time, time]);
    this.db.run('UPDATE education_plans SET updated_at=? WHERE id=?', [time, planId]);
    return this.getPlan(planId).lessons.find((lesson) => lesson.id === key)!;
  }

  updateProgress(lessonId: string, status: unknown): Lesson {
    const lesson = this.getLesson(lessonId);
    if (typeof status !== 'string' || !['not_started', 'in_progress', 'completed'].includes(status)) throw new EducationError('Choose not_started, in_progress, or completed.');
    const time = timestamp();
    this.db.run('UPDATE education_lessons SET status=?,updated_at=? WHERE id=?', [status, time, lessonId]);
    this.db.run('UPDATE education_plans SET updated_at=? WHERE id=?', [time, lesson.plan_id]);
    return this.getLesson(lessonId);
  }

  getLesson(lessonId: string): Lesson {
    const row = this.db.get<{ plan_id: string }>('SELECT plan_id FROM education_lessons WHERE id=?', [lessonId]);
    if (!row) throw new EducationError('Lesson not found.', 404);
    return this.getPlan(row.plan_id).lessons.find((lesson) => lesson.id === lessonId)!;
  }

  addQuestion(lessonId: string, input: { kind: unknown; prompt: unknown; options?: unknown; correct_index?: unknown; answer?: unknown }): QuizQuestion {
    this.getLesson(lessonId);
    const prompt = requiredText(input.prompt, 'Question', 1000);
    if (input.kind !== 'multiple_choice' && input.kind !== 'recall') throw new EducationError('Question kind must be multiple_choice or recall.');
    if ((this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM education_questions WHERE lesson_id=?', [lessonId])?.count ?? 0) >= 100) throw new EducationError('Question limit of 100 per lesson reached.', 409);
    let options: string[] = [], correctAnswer: string;
    if (input.kind === 'multiple_choice') {
      if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 5) throw new EducationError('Multiple-choice questions need 2 to 5 options.');
      options = input.options.map((option) => requiredText(option, 'Option', 300));
      if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) throw new EducationError('Options must be unique.');
      if (!Number.isInteger(input.correct_index) || (input.correct_index as number) < 0 || (input.correct_index as number) >= options.length) throw new EducationError('Select a valid correct option.');
      correctAnswer = String(input.correct_index);
    } else {
      correctAnswer = requiredText(input.answer, 'Recall answer', 500);
    }
    const key = id(), time = timestamp();
    this.db.run('INSERT INTO education_questions (id,lesson_id,kind,prompt,options,correct_answer,created_at) VALUES (?,?,?,?,?,?,?)', [key, lessonId, input.kind, prompt, JSON.stringify(options), correctAnswer, time]);
    return { id: key, lesson_id: lessonId, kind: input.kind, prompt, options, created_at: time };
  }

  quiz(lessonId: string): QuizQuestion[] {
    this.getLesson(lessonId);
    return this.db.all<any>('SELECT id,lesson_id,kind,prompt,options,created_at FROM education_questions WHERE lesson_id=? ORDER BY created_at,rowid', [lessonId])
      .map((row) => ({ ...row, options: JSON.parse(row.options) as string[] }));
  }

  attempts(lessonId: string): QuizAttempt[] {
    this.getLesson(lessonId);
    return this.db.all<any>('SELECT * FROM education_attempts WHERE lesson_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100', [lessonId])
      .map((row) => ({ ...row, results: JSON.parse(row.results) as QuizResult[] }));
  }

  submitAttempt(lessonId: string, input: { answers: unknown }): QuizAttempt {
    const quiz = this.quiz(lessonId);
    if (!quiz.length) throw new EducationError('Add at least one quiz question before submitting an attempt.');
    if (!Array.isArray(input.answers) || input.answers.length > quiz.length) throw new EducationError('Answers must be an array with at most one answer per question.');
    if ((this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM education_attempts WHERE lesson_id=?', [lessonId])?.count ?? 0) >= 500) throw new EducationError('Attempt limit of 500 per lesson reached.', 409);
    const answers = new Map<string, string | number>();
    for (const item of input.answers) {
      if (!item || typeof item !== 'object') throw new EducationError('Each answer needs a question id and answer.');
      const record = item as Record<string, unknown>;
      const question = typeof record.question_id === 'string' ? quiz.find((item) => item.id === record.question_id) : undefined;
      if (!question || answers.has(question.id)) throw new EducationError('Answers include an unknown or duplicate question.');
      if (question.kind === 'multiple_choice' && (typeof record.answer !== 'number' || !Number.isInteger(record.answer) || record.answer < 0 || record.answer >= question.options.length)) throw new EducationError('Choose a valid option index.');
      if (question.kind === 'recall' && (typeof record.answer !== 'string' || record.answer.length > 500)) throw new EducationError('Recall answer must be text up to 500 characters.');
      answers.set(question.id, record.answer as string | number);
    }
    const stored = this.db.all<{ id: string; kind: QuizQuestion['kind']; correct_answer: string }>('SELECT id,kind,correct_answer FROM education_questions WHERE lesson_id=?', [lessonId]);
    const correct = new Map(stored.map((question) => [question.id, question.correct_answer]));
    const results: QuizResult[] = quiz.map((question) => {
      const answer = answers.get(question.id) ?? null;
      const expected = correct.get(question.id)!;
      const matched = question.kind === 'multiple_choice'
        ? typeof answer === 'number' && Number.isInteger(answer) && answer === Number(expected)
        : typeof answer === 'string' && normalizeRecall(answer) === normalizeRecall(expected);
      return { question_id: question.id, prompt: question.prompt, kind: question.kind, answer, correct: matched, correct_answer: question.kind === 'multiple_choice' ? Number(expected) : expected };
    });
    const correctCount = results.filter((result) => result.correct).length;
    const attempt: QuizAttempt = { id: id(), lesson_id: lessonId, correct_count: correctCount, total_count: quiz.length, percent: Math.round(correctCount / quiz.length * 100), results, created_at: timestamp() };
    this.db.run('INSERT INTO education_attempts (id,lesson_id,correct_count,total_count,percent,results,created_at) VALUES (?,?,?,?,?,?,?)', [attempt.id, attempt.lesson_id, attempt.correct_count, attempt.total_count, attempt.percent, JSON.stringify(results), attempt.created_at]);
    return attempt;
  }
}
