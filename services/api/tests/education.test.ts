import Fastify from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Database } from '../src/db/database.js';
import { EducationService } from '../src/education/service.js';
import { registerEducationRoutes } from '../src/server/routes/education.js';

function setup() {
  const db = new Database(':memory:');
  db.migrate();
  const education = new EducationService(db);
  return { db, education };
}

describe('EducationService', () => {
  it('retains plans and quiz attempts after reopening the database file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-education-test-'));
    const file = path.join(directory, 'education.sqlite');
    try {
      const firstDb = new Database(file);
      firstDb.migrate();
      const first = new EducationService(firstDb);
      const plan = first.createPlan({ title: 'Persistence' });
      const lesson = first.createLesson(plan.id, { title: 'Recall' });
      const question = first.addQuestion(lesson.id, { kind: 'recall', prompt: 'Keyword?', answer: 'durable' });
      const attempt = first.submitAttempt(lesson.id, { answers: [{ question_id: question.id, answer: 'durable' }] });
      firstDb.close();

      const secondDb = new Database(file);
      secondDb.migrate();
      const second = new EducationService(secondDb);
      expect(second.getPlan(plan.id).lessons[0].attempt_count).toBe(1);
      expect(second.attempts(lesson.id)[0]).toMatchObject({ id: attempt.id, percent: 100 });
      secondDb.close();
    } finally {
      for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
      fs.rmdirSync(directory);
    }
  });

  it('stores user-created plans and lessons, validates resource links, and tracks progress', () => {
    const { db, education } = setup();
    expect(education.listPlans()).toEqual([]);
    const plan = education.createPlan({ title: 'Learn TypeScript', goal: 'Build a small app' });
    expect(() => education.createLesson(plan.id, { title: 'Unsafe', resources: [{ label: 'bad', url: 'javascript:alert(1)' }] })).toThrow(/HTTP or HTTPS/);
    const lesson = education.createLesson(plan.id, { title: 'Types', content: 'Practice types and functions.', resources: [{ label: 'Reference', url: 'https://example.com/types' }] });
    expect(lesson.content).toBe('Practice types and functions.');
    expect(lesson.resources[0].url).toBe('https://example.com/types');
    expect(education.getPlan(plan.id).plan.progress_percent).toBe(0);
    education.updateProgress(lesson.id, 'completed');
    expect(education.getPlan(plan.id).plan).toMatchObject({ lesson_count: 1, completed_count: 1, progress_percent: 100 });
    db.close();
  });

  it('persists deterministic multiple-choice and exact normalized recall attempts', () => {
    const { db, education } = setup();
    const plan = education.createPlan({ title: 'Math' });
    const lesson = education.createLesson(plan.id, { title: 'Arithmetic' });
    const choice = education.addQuestion(lesson.id, { kind: 'multiple_choice', prompt: '2 + 2?', options: ['3', '4', '5'], correct_index: 1 });
    const recall = education.addQuestion(lesson.id, { kind: 'recall', prompt: 'Name the operation used to combine numbers.', answer: 'Addition' });
    expect(education.quiz(lesson.id)).toHaveLength(2);
    expect(JSON.stringify(education.quiz(lesson.id))).not.toContain('Addition');
    expect(() => education.submitAttempt(lesson.id, { answers: [{ question_id: choice.id, answer: 1 }, { question_id: choice.id, answer: 1 }] })).toThrow(/duplicate/);
    const first = education.submitAttempt(lesson.id, { answers: [{ question_id: choice.id, answer: 1 }, { question_id: recall.id, answer: '  ADDITION  ' }] });
    expect(first).toMatchObject({ correct_count: 2, total_count: 2, percent: 100 });
    const second = education.submitAttempt(lesson.id, { answers: [{ question_id: choice.id, answer: 0 }] });
    expect(second).toMatchObject({ correct_count: 0, total_count: 2, percent: 0 });
    expect(education.attempts(lesson.id).map((attempt) => attempt.id)).toEqual([second.id, first.id]);
    const reloaded = new EducationService(db);
    expect(reloaded.getPlan(plan.id).lessons[0]).toMatchObject({ question_count: 2, attempt_count: 2, best_percent: 100 });
    expect(reloaded.attempts(lesson.id)[0].results[0]).toMatchObject({ correct: false, correct_answer: 1 });
    reloaded.addQuestion(lesson.id, { kind: 'recall', prompt: 'What is 3 + 3?', answer: '6' });
    expect(reloaded.getLesson(lesson.id).best_percent).toBeNull();
    db.close();
  });
});

describe('education API', () => {
  it('deletes a plan and its lessons, questions, and attempts', async () => {
    const { db, education } = setup();
    const app = Fastify();
    registerEducationRoutes(app, { education });
    const plan = education.createPlan({ title: 'Temporary' });
    const lesson = education.createLesson(plan.id, { title: 'Practice' });
    const question = education.addQuestion(lesson.id, { kind: 'recall', prompt: 'Word?', answer: 'yes' });
    education.submitAttempt(lesson.id, { answers: [{ question_id: question.id, answer: 'yes' }] });
    const response = await app.inject({ method: 'DELETE', url: `/api/v1/education/plans/${plan.id}` });
    expect(response.statusCode).toBe(204);
    expect(education.listPlans()).toEqual([]);
    expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM education_lessons')?.count).toBe(0);
    expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM education_questions')?.count).toBe(0);
    expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM education_attempts')?.count).toBe(0);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/education/plans/${plan.id}` })).statusCode).toBe(404);
    await app.close(); db.close();
  });

  it('creates a plan, lesson and quiz, scores an attempt, and returns honest errors', async () => {
    const { db, education } = setup();
    const app = Fastify();
    registerEducationRoutes(app, { education });
    const empty = await app.inject({ method: 'GET', url: '/api/v1/education/plans' });
    expect(empty.json().plans).toEqual([]);
    const planResponse = await app.inject({ method: 'POST', url: '/api/v1/education/plans', payload: { title: 'French' } });
    expect(planResponse.statusCode).toBe(201);
    const planId = planResponse.json().plan.id;
    const lessonResponse = await app.inject({ method: 'POST', url: `/api/v1/education/plans/${planId}/lessons`, payload: { title: 'Greetings', content: 'Bonjour means hello.' } });
    expect(lessonResponse.statusCode).toBe(201);
    const lessonId = lessonResponse.json().lesson.id;
    const questionResponse = await app.inject({ method: 'POST', url: `/api/v1/education/lessons/${lessonId}/questions`, payload: { kind: 'recall', prompt: 'How do you say hello?', answer: 'Bonjour' } });
    expect(questionResponse.statusCode).toBe(201);
    const questionId = questionResponse.json().question.id;
    const quiz = await app.inject({ method: 'GET', url: `/api/v1/education/lessons/${lessonId}/quiz` });
    expect(quiz.json().questions[0]).not.toHaveProperty('correct_answer');
    const attempt = await app.inject({ method: 'POST', url: `/api/v1/education/lessons/${lessonId}/attempts`, payload: { answers: [{ question_id: questionId, answer: 'bonjour' }] } });
    expect(attempt.statusCode).toBe(201);
    expect(attempt.json().attempt.percent).toBe(100);
    const missing = await app.inject({ method: 'GET', url: '/api/v1/education/plans/unknown' });
    expect(missing.statusCode).toBe(404);
    const invalid = await app.inject({ method: 'PATCH', url: `/api/v1/education/lessons/${lessonId}/progress`, payload: { status: 'imagined' } });
    expect(invalid.statusCode).toBe(400);
    await app.close(); db.close();
  });
});
