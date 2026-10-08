import React, { useEffect, useState } from 'react';
import { BookOpen, CircleHelp, AlertCircle } from 'lucide-react';
import { apiFetch } from '../api';

type Plan = { id: string; title: string; goal: string; lesson_count: number; completed_count: number; progress_percent: number };
type Resource = { label: string; url: string };
type Lesson = { id: string; plan_id: string; title: string; content: string; resources: Resource[]; status: 'not_started' | 'in_progress' | 'completed'; question_count: number; attempt_count: number; best_percent: number | null };
type Question = { id: string; kind: 'multiple_choice' | 'recall'; prompt: string; options: string[] };
type Attempt = { id: string; correct_count: number; total_count: number; percent: number; created_at: string; results: { question_id: string; prompt: string; kind: Question['kind']; answer: string | number | null; correct: boolean; correct_answer: string | number }[] };

const inputStyle: React.CSSProperties = { padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 7, background: 'var(--bg-card)', color: 'var(--text-main)', font: 'inherit' };
const buttonStyle: React.CSSProperties = { padding: '9px 14px', border: 0, borderRadius: 7, background: 'var(--accent-cyan)', color: '#000', fontWeight: 700, cursor: 'pointer' };
const sectionStyle: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 18 };

export const EducationView: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [latestAttempt, setLatestAttempt] = useState<Attempt | null>(null);
  const [planTitle, setPlanTitle] = useState('');
  const [planGoal, setPlanGoal] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonContent, setLessonContent] = useState('');
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceLabel, setResourceLabel] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [questionKind, setQuestionKind] = useState<Question['kind']>('multiple_choice');
  const [prompt, setPrompt] = useState('');
  const [choiceLines, setChoiceLines] = useState('');
  const [correctIndex, setCorrectIndex] = useState(0);
  const [recallAnswer, setRecallAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPlans = async () => {
    const result = await apiFetch<{ plans: Plan[] }>('/api/v1/education/plans');
    setPlans(result.plans);
  };
  const loadPlan = async (id: string) => {
    const result = await apiFetch<{ plan: Plan; lessons: Lesson[] }>(`/api/v1/education/plans/${encodeURIComponent(id)}`);
    setPlan(result.plan); setLessons(result.lessons);
  };
  const loadLesson = async (id: string) => {
    const [quiz, history] = await Promise.all([
      apiFetch<{ questions: Question[] }>(`/api/v1/education/lessons/${encodeURIComponent(id)}/quiz`),
      apiFetch<{ attempts: Attempt[] }>(`/api/v1/education/lessons/${encodeURIComponent(id)}/attempts`),
    ]);
    setQuestions(quiz.questions); setAttempts(history.attempts);
  };
  useEffect(() => { loadPlans().catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    setPlan(null); setLessons([]); setSelectedLessonId(''); setQuestions([]); setAttempts([]); setLatestAttempt(null);
    if (selectedPlanId) loadPlan(selectedPlanId).catch((e: Error) => setError(e.message));
  }, [selectedPlanId]);
  useEffect(() => {
    setQuestions([]); setAttempts([]); setAnswers({}); setLatestAttempt(null);
    if (selectedLessonId) loadLesson(selectedLessonId).catch((e: Error) => setError(e.message));
  }, [selectedLessonId]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const createPlan = (event: React.FormEvent) => { event.preventDefault(); void act(async () => {
    const result = await apiFetch<{ plan: Plan }>('/api/v1/education/plans', { method: 'POST', body: JSON.stringify({ title: planTitle, goal: planGoal }) });
    setPlanTitle(''); setPlanGoal(''); await loadPlans(); setSelectedPlanId(result.plan.id);
  }); };
  const deletePlan = () => {
    if (!plan || !window.confirm(`Delete “${plan.title}” and all its lessons, questions, and quiz attempts?`)) return;
    const planId = plan.id;
    void act(async () => {
      await apiFetch(`/api/v1/education/plans/${encodeURIComponent(planId)}`, { method: 'DELETE' });
      setSelectedPlanId(''); setPlan(null); setLessons([]); setSelectedLessonId('');
      await loadPlans();
    });
  };
  const createLesson = (event: React.FormEvent) => { event.preventDefault(); if (!selectedPlanId) return; void act(async () => {
    const result = await apiFetch<{ lesson: Lesson }>(`/api/v1/education/plans/${encodeURIComponent(selectedPlanId)}/lessons`, { method: 'POST', body: JSON.stringify({ title: lessonTitle, content: lessonContent, resources }) });
    setLessonTitle(''); setLessonContent(''); setResources([]); await Promise.all([loadPlan(selectedPlanId), loadPlans()]); setSelectedLessonId(result.lesson.id);
  }); };
  const addResource = () => {
    if (!resourceLabel.trim() || !resourceUrl.trim() || resources.length >= 10) return;
    try { const url = new URL(resourceUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); setResources((current) => [...current, { label: resourceLabel.trim(), url: url.toString() }]); setResourceLabel(''); setResourceUrl(''); setError(null); }
    catch { setError('Resource URL must begin with http:// or https://.'); }
  };
  const setProgress = (status: Lesson['status']) => { if (!selectedLessonId || !selectedPlanId) return; void act(async () => {
    await apiFetch(`/api/v1/education/lessons/${encodeURIComponent(selectedLessonId)}/progress`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await Promise.all([loadPlan(selectedPlanId), loadPlans()]);
  }); };
  const addQuestion = (event: React.FormEvent) => { event.preventDefault(); if (!selectedLessonId || !selectedPlanId) return; void act(async () => {
    const options = choiceLines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const body = questionKind === 'multiple_choice' ? { kind: questionKind, prompt, options, correct_index: correctIndex } : { kind: questionKind, prompt, answer: recallAnswer };
    await apiFetch(`/api/v1/education/lessons/${encodeURIComponent(selectedLessonId)}/questions`, { method: 'POST', body: JSON.stringify(body) });
    setPrompt(''); setChoiceLines(''); setRecallAnswer(''); setCorrectIndex(0);
    await Promise.all([loadLesson(selectedLessonId), loadPlan(selectedPlanId)]);
  }); };
  const submitQuiz = (event: React.FormEvent) => { event.preventDefault(); if (!selectedLessonId || !selectedPlanId) return; void act(async () => {
    const submitted = Object.entries(answers).map(([question_id, answer]) => ({ question_id, answer }));
    const result = await apiFetch<{ attempt: Attempt }>(`/api/v1/education/lessons/${encodeURIComponent(selectedLessonId)}/attempts`, { method: 'POST', body: JSON.stringify({ answers: submitted }) });
    setLatestAttempt(result.attempt); setAnswers({}); await Promise.all([loadLesson(selectedLessonId), loadPlan(selectedPlanId)]);
  }); };

  const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId);
  const options = choiceLines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return <div style={{ maxWidth: 1250, margin: '0 auto', padding: 24, color: 'var(--text-main)', display: 'grid', gap: 18 }}>
    <header><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><BookOpen color="var(--accent-cyan)" /><h1 style={{ margin: 0 }}>Tutor & study plans</h1></div><p style={{ color: 'var(--text-muted)' }}>Create your own lessons and quiz questions. TJ tracks progress and scores answers locally; it does not generate course material in this mode.</p></header>
    {error && <p role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fb7185', background: 'rgba(244,63,94,.1)', padding: 13, borderRadius: 8 }}><AlertCircle size={18} />{error}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 300px) minmax(0, 1fr)', gap: 16 }}>
      <aside style={{ ...sectionStyle, display: 'grid', alignContent: 'start', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Study plans</h2>
        {plans.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No study plans yet.</p>}
        {plans.map((item) => <button key={item.id} type="button" onClick={() => setSelectedPlanId(item.id)} style={{ textAlign: 'left', padding: 10, borderRadius: 8, border: '1px solid var(--border-subtle)', background: item.id === selectedPlanId ? 'var(--bg-card-hover)' : 'var(--bg-card)', color: 'var(--text-main)', cursor: 'pointer' }}><strong>{item.title}</strong><small style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)' }}>{item.completed_count}/{item.lesson_count} lessons · {item.progress_percent}%</small></button>)}
        <form onSubmit={createPlan} style={{ display: 'grid', gap: 8, marginTop: 10 }}><strong>New plan</strong><input style={inputStyle} maxLength={140} required placeholder="Plan title" value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} /><textarea style={inputStyle} maxLength={500} rows={2} placeholder="Goal (optional)" value={planGoal} onChange={(e) => setPlanGoal(e.target.value)} /><button style={buttonStyle} disabled={busy}>Create plan</button></form>
      </aside>
      <main style={{ display: 'grid', alignContent: 'start', gap: 16 }}>
        {!plan && <section style={sectionStyle}><h2>Select or create a study plan</h2><p style={{ color: 'var(--text-muted)' }}>Lessons and quiz content are added by you.</p></section>}
        {plan && <>
          <section style={sectionStyle}><h2 style={{ marginTop: 0 }}>{plan.title}</h2>{plan.goal && <p>{plan.goal}</p>}<p>{plan.completed_count} of {plan.lesson_count} lessons complete · {plan.progress_percent}%</p><div style={{ height: 9, borderRadius: 6, background: 'var(--bg-card)' }}><div style={{ width: `${plan.progress_percent}%`, height: '100%', borderRadius: 6, background: 'var(--accent-cyan)' }} /></div><button type="button" onClick={deletePlan} disabled={busy} style={{ marginTop: 16, padding: '8px 12px', border: '1px solid #fb7185', borderRadius: 7, background: 'transparent', color: '#fb7185', cursor: 'pointer' }}>Delete plan</button></section>
          <section style={sectionStyle}><h2 style={{ marginTop: 0 }}>Lessons</h2>{lessons.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Add the first lesson below.</p>}{lessons.map((lesson) => <button key={lesson.id} type="button" onClick={() => setSelectedLessonId(lesson.id)} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 7, padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 7, background: lesson.id === selectedLessonId ? 'var(--bg-card-hover)' : 'var(--bg-card)', color: 'var(--text-main)', cursor: 'pointer' }}><strong>{lesson.title}</strong><small style={{ display: 'block', color: 'var(--text-muted)' }}>{lesson.status.replace('_', ' ')} · {lesson.question_count} questions · best quiz {lesson.best_percent == null ? '—' : `${lesson.best_percent}%`}</small></button>)}
            <form onSubmit={createLesson} style={{ display: 'grid', gap: 8, marginTop: 16 }}><h3 style={{ margin: 0 }}>Add lesson</h3><input style={inputStyle} maxLength={140} required placeholder="Lesson title" value={lessonTitle} onChange={(e) => setLessonTitle(e.target.value)} /><textarea style={inputStyle} maxLength={30000} rows={4} placeholder="Lesson notes or explanation written by you" value={lessonContent} onChange={(e) => setLessonContent(e.target.value)} /><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><input style={{ ...inputStyle, flex: 1 }} maxLength={120} placeholder="Resource label" value={resourceLabel} onChange={(e) => setResourceLabel(e.target.value)} /><input style={{ ...inputStyle, flex: 2 }} maxLength={2000} type="url" placeholder="https://..." value={resourceUrl} onChange={(e) => setResourceUrl(e.target.value)} /><button type="button" onClick={addResource} style={{ ...buttonStyle, background: 'var(--bg-card-hover)', color: 'var(--text-main)' }}>Add link</button></div>{resources.map((resource, index) => <small key={index}>{resource.label}: {resource.url} <button type="button" onClick={() => setResources((current) => current.filter((_, i) => i !== index))}>Remove</button></small>)}<button style={{ ...buttonStyle, justifySelf: 'start' }} disabled={busy}>Save lesson</button></form>
          </section>
          {selectedLesson && <>
            <section style={sectionStyle}><h2 style={{ marginTop: 0 }}>{selectedLesson.title}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{selectedLesson.content || 'No lesson notes added.'}</p>{selectedLesson.resources.length > 0 && <div><strong>Resources</strong><ul>{selectedLesson.resources.map((resource, index) => <li key={index}><a href={resource.url} target="_blank" rel="noopener noreferrer">{resource.label}</a></li>)}</ul></div>}<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><label htmlFor="education-progress">Progress</label><select id="education-progress" value={selectedLesson.status} onChange={(e) => setProgress(e.target.value as Lesson['status'])} disabled={busy} style={inputStyle}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></div></section>
            <section style={sectionStyle}><h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}><CircleHelp size={20} />Quiz & recall</h2>{questions.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Add your first question below.</p>}{questions.length > 0 && <form onSubmit={submitQuiz} style={{ display: 'grid', gap: 12 }}>{questions.map((question, index) => <div key={question.id} style={{ background: 'var(--bg-card)', borderRadius: 7, padding: 12 }}><strong>{index + 1}. {question.prompt}</strong>{question.kind === 'multiple_choice' ? <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{question.options.map((option, optionIndex) => <label key={optionIndex}><input type="radio" name={question.id} checked={answers[question.id] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} /> {option}</label>)}</div> : <input style={{ ...inputStyle, display: 'block', width: 'min(100%, 450px)', marginTop: 8 }} maxLength={500} placeholder="Your exact recall answer" value={typeof answers[question.id] === 'string' ? answers[question.id] : ''} onChange={(e) => setAnswers((current) => ({ ...current, [question.id]: e.target.value }))} />}</div>)}<button disabled={busy} style={{ ...buttonStyle, justifySelf: 'start' }}>Submit attempt</button></form>}
              {latestAttempt && <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 14, marginTop: 14 }}><strong>Latest attempt: {latestAttempt.correct_count}/{latestAttempt.total_count} ({latestAttempt.percent}%)</strong><ul>{latestAttempt.results.map((result) => <li key={result.question_id} style={{ color: result.correct ? 'var(--accent-cyan)' : '#fb7185' }}>{result.prompt}: {result.correct ? 'Correct' : 'Incorrect'}{!result.correct && ` · expected ${result.kind === 'multiple_choice' ? questions.find((q) => q.id === result.question_id)?.options[Number(result.correct_answer)] ?? result.correct_answer : result.correct_answer}`}</li>)}</ul></div>}
              {attempts.length > 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{attempts.length} recent attempts · best {selectedLesson.best_percent ?? 0}%</p>}
              <form onSubmit={addQuestion} style={{ display: 'grid', gap: 8, marginTop: 18 }}><h3 style={{ margin: 0 }}>Add question</h3><select style={inputStyle} value={questionKind} onChange={(e) => setQuestionKind(e.target.value as Question['kind'])}><option value="multiple_choice">Multiple choice</option><option value="recall">Exact recall</option></select><input style={inputStyle} maxLength={1000} required placeholder="Question" value={prompt} onChange={(e) => setPrompt(e.target.value)} />{questionKind === 'multiple_choice' ? <><textarea style={inputStyle} rows={4} placeholder="Options, one per line (2 to 5)" value={choiceLines} onChange={(e) => { setChoiceLines(e.target.value); setCorrectIndex(0); }} /><label>Correct option <select style={inputStyle} value={correctIndex} onChange={(e) => setCorrectIndex(Number(e.target.value))}>{options.map((option, index) => <option key={index} value={index}>{index + 1}. {option}</option>)}</select></label></> : <input style={inputStyle} maxLength={500} required placeholder="Expected answer (exact match after case/space normalization)" value={recallAnswer} onChange={(e) => setRecallAnswer(e.target.value)} />}<button disabled={busy} style={{ ...buttonStyle, justifySelf: 'start' }}>Save question</button></form>
            </section>
          </>}
        </>}
      </main>
    </div>
  </div>;
};
