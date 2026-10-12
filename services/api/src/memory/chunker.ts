/**
 * Semantic & Structural Document Chunker (RAG Best Practices).
 *
 * Implements context-preserving chunking for:
 * 1. Markdown documents (preserves heading hierarchies, keeps code-blocks & tables whole).
 * 2. Source code (preserves declarations, function/class blocks, and line numbering).
 * 3. Plain prose / text (preserves sentence boundaries with contextual overlap).
 */

export type DocumentFormat = 'markdown' | 'code' | 'text' | 'auto';

export interface ChunkOptions {
  format?: DocumentFormat;
  filePath?: string;
  targetChunkChars?: number;
  maxChunkChars?: number;
  overlapChars?: number;
}

export interface DocumentChunk {
  content: string;
  chunk_index: number;
  total_chunks: number;
  section_title?: string;
  char_count: number;
  start_line: number;
  end_line: number;
  file_path?: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_TARGET_CHARS = 800;
const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 120;

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.json', '.yaml', '.yml', '.sql',
  '.rs', '.go', '.java', '.c', '.cpp', '.h', '.cs',
]);

const MD_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mdx']);

export function detectFormat(content: string, filePath?: string): 'markdown' | 'code' | 'text' {
  if (filePath) {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    if (MD_EXTENSIONS.has(ext)) return 'markdown';
    if (CODE_EXTENSIONS.has(ext)) return 'code';
  }
  if (/^#{1,6}\s+/m.test(content) || /```[a-z]*\n[\s\S]*?```/m.test(content)) {
    return 'markdown';
  }
  if (
    /^(import|export|function|class|interface|type|const|let|def|class)\s+[A-Za-z0-9_]/m.test(content) ||
    /^\s*(\{|\}|\[|\])\s*$/m.test(content)
  ) {
    return 'code';
  }
  return 'text';
}

/**
 * Main chunking entrypoint.
 */
export function chunkDocument(rawContent: string, options: ChunkOptions = {}): DocumentChunk[] {
  const content = rawContent.replace(/\r\n/g, '\n').trim();
  if (!content) return [];

  const targetChars = options.targetChunkChars ?? DEFAULT_TARGET_CHARS;
  const maxChars = options.maxChunkChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const format = (!options.format || options.format === 'auto')
    ? detectFormat(content, options.filePath)
    : options.format;

  let chunks: Omit<DocumentChunk, 'chunk_index' | 'total_chunks'>[] = [];

  switch (format) {
    case 'markdown':
      chunks = chunkMarkdown(content, targetChars, maxChars, options.filePath);
      break;
    case 'code':
      chunks = chunkCode(content, targetChars, maxChars, overlapChars, options.filePath);
      break;
    case 'text':
    default:
      chunks = chunkProse(content, targetChars, maxChars, overlapChars, options.filePath);
      break;
  }

  // Final pass: assign chunk_index and total_chunks
  const total = chunks.length;
  return chunks.map((c, i) => ({
    ...c,
    chunk_index: i,
    total_chunks: total,
  }));
}

/**
 * Chunks markdown files respecting headers, code blocks, and lists.
 */
function chunkMarkdown(
  content: string,
  targetChars: number,
  maxChars: number,
  filePath?: string,
): Omit<DocumentChunk, 'chunk_index' | 'total_chunks'>[] {
  const lines = content.split('\n');
  const results: Omit<DocumentChunk, 'chunk_index' | 'total_chunks'>[] = [];

  // Track heading stack for contextual breadcrumbs
  const headingStack: { level: number; title: string }[] = [];
  let currentLines: string[] = [];
  let chunkStartLine = 1;
  let inCodeBlock = false;

  const flush = (endLine: number) => {
    if (currentLines.length === 0) return;
    const text = currentLines.join('\n').trim();
    if (!text) {
      currentLines = [];
      return;
    }

    const breadcrumbs = headingStack.map((h) => h.title).join(' > ');
    const sectionTitle = headingStack.length > 0 ? headingStack[headingStack.length - 1].title : undefined;

    // Prepend heading breadcrumb if section is known and not already present at top of chunk
    let formattedContent = text;
    if (breadcrumbs && !text.startsWith('#')) {
      formattedContent = `[Section: ${breadcrumbs}]\n${text}`;
    }

    results.push({
      content: formattedContent,
      section_title: sectionTitle,
      char_count: formattedContent.length,
      start_line: chunkStartLine,
      end_line: endLine,
      file_path: filePath,
      metadata: {
        format: 'markdown',
        breadcrumbs,
      },
    });

    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check code fences
    if (/^```/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
    }

    // Check headings (only when outside code blocks)
    const headingMatch = !inCodeBlock ? line.match(/^(#{1,6})\s+(.*)$/) : null;

    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      // If we have accumulated enough text, flush previous chunk
      if (currentLines.length > 0) {
        flush(lineNum - 1);
        chunkStartLine = lineNum;
      }

      // Update heading stack
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
      currentLines.push(line);
      continue;
    }

    currentLines.push(line);

    // If accumulated size exceeds target and we are not inside code block
    const currentLength = currentLines.reduce((acc, l) => acc + l.length + 1, 0);
    if (!inCodeBlock && currentLength >= targetChars) {
      // Look for natural breaks: empty lines or end of paragraphs
      if (line.trim() === '' || currentLength >= maxChars) {
        flush(lineNum);
        chunkStartLine = lineNum + 1;
      }
    }
  }

  flush(lines.length);
  return results;
}

/**
 * Chunks source code while respecting function/class boundaries and line ranges.
 */
function chunkCode(
  content: string,
  targetChars: number,
  maxChars: number,
  overlapChars: number,
  filePath?: string,
): Omit<DocumentChunk, 'chunk_index' | 'total_chunks'>[] {
  const lines = content.split('\n');
  const results: Omit<DocumentChunk, 'chunk_index' | 'total_chunks'>[] = [];

  let currentLines: string[] = [];
  let chunkStartLine = 1;
  let currentSymbol: string | undefined;

  const flush = (endLine: number) => {
    if (currentLines.length === 0) return;
    const text = currentLines.join('\n').trim();
    if (!text) {
      currentLines = [];
      return;
    }

    results.push({
      content: text,
      section_title: currentSymbol,
      char_count: text.length,
      start_line: chunkStartLine,
      end_line: endLine,
      file_path: filePath,
      metadata: {
        format: 'code',
        symbol: currentSymbol,
      },
    });

    currentLines = [];
  };

  const SYMBOL_PATTERN = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum|def|struct|impl)\s+([A-Za-z0-9_$]+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const match = line.match(SYMBOL_PATTERN);
    if (match) {
      const symbolName = match[1];
      const currentLength = currentLines.reduce((acc, l) => acc + l.length + 1, 0);

      if (currentLength >= targetChars) {
        flush(lineNum - 1);
        chunkStartLine = lineNum;
      }
      currentSymbol = symbolName;
    }

    currentLines.push(line);

    const currentLength = currentLines.reduce((acc, l) => acc + l.length + 1, 0);
    if (currentLength >= maxChars) {
      flush(lineNum);
      chunkStartLine = lineNum + 1;
    }
  }

  flush(lines.length);
  return results;
}

/**
 * Chunks prose text preserving sentences and adding sliding-window overlap.
 */
function chunkProse(
  content: string,
  targetChars: number,
  maxChars: number,
  overlapChars: number,
  filePath?: string,
): Omit<DocumentChunk, 'chunk_index' | 'total_chunks'>[] {
  const paragraphs = content.split(/\n\s*\n+/);
  const results: Omit<DocumentChunk, 'chunk_index' | 'total_chunks'>[] = [];

  let currentText = '';
  let startLine = 1;
  let currentLine = 1;

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx].trim();
    if (!para) continue;

    const paraLines = para.split('\n').length;

    if (currentText.length + para.length + 2 <= targetChars) {
      currentText = currentText ? `${currentText}\n\n${para}` : para;
      currentLine += paraLines + 1;
    } else if (currentText.length + para.length + 2 <= maxChars) {
      currentText = currentText ? `${currentText}\n\n${para}` : para;
      currentLine += paraLines + 1;
      // Flush
      results.push({
        content: currentText,
        char_count: currentText.length,
        start_line: startLine,
        end_line: currentLine,
        file_path: filePath,
        metadata: { format: 'text' },
      });
      // Carry overlap if needed
      const sentences = currentText.match(/[^.!?]+[.!?]+(\s+|$)/g) || [currentText];
      const overlapText = sentences.slice(-1).join('').trim();
      currentText = overlapText.length <= overlapChars ? overlapText : '';
      startLine = currentLine;
    } else {
      // Paragraph itself is very long: split by sentence
      const sentences = para.match(/[^.!?]+[.!?]+(\s+|$)/g) || [para];
      for (const sent of sentences) {
        if (currentText.length + sent.length <= maxChars) {
          currentText = currentText ? `${currentText} ${sent.trim()}` : sent.trim();
        } else {
          if (currentText) {
            results.push({
              content: currentText,
              char_count: currentText.length,
              start_line: startLine,
              end_line: currentLine,
              file_path: filePath,
              metadata: { format: 'text' },
            });
            const lastSent = currentText.match(/[^.!?]+[.!?]+(\s+|$)/g)?.slice(-1)[0] || '';
            currentText = lastSent.length <= overlapChars ? `${lastSent.trim()} ${sent.trim()}` : sent.trim();
            startLine = currentLine;
          } else {
            currentText = sent.trim();
          }
        }
      }
      currentLine += paraLines + 1;
    }
  }

  if (currentText.trim()) {
    results.push({
      content: currentText.trim(),
      char_count: currentText.trim().length,
      start_line: startLine,
      end_line: currentLine,
      file_path: filePath,
      metadata: { format: 'text' },
    });
  }

  return results;
}
