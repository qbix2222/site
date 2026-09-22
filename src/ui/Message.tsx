import { useState } from 'react';
import type { UIMessage } from 'ai';
import { isFileUIPart, isReasoningUIPart, isTextUIPart, isToolUIPart } from 'ai';
import { labelForTool } from '../agent/tools';
import { useChatStore } from '../store/chat-store';
import { Markdown } from './markdown';
import {
  asToolPart,
  outputSummary,
  outputText,
  stateLabel,
  toolBody,
  toolHeadline,
} from './tool-view';
import { duration, tokens } from './format';

function ToolCard({ part }: { part: unknown }) {
  const tool = asToolPart(part);
  const [expanded, setExpanded] = useState(false);
  const name = tool.type?.replace(/^tool-/, '') ?? 'tool';
  const headline = toolHeadline(tool.input);
  const body = toolBody(tool.input);
  const output = outputText(tool.output);
  const failed = tool.state === 'output-error' || tool.state === 'output-denied';

  return (
    <div className="tool-card">
      <button
        type="button"
        className="tool-head tool-head-button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className={failed ? 'dot dot-dead' : tool.state === 'output-available' ? 'dot dot-live' : 'dot dot-busy'} />
        <span className="tool-name">{labelForTool(name)}</span>
        {headline && <span className="tool-target mono">{headline}</span>}
        <span className="tool-state">{tool.errorText ? 'сбой' : stateLabel(tool.state)}</span>
        <svg
          className="tool-caret"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
          data-open={expanded}
        >
          <path d="M2 3.5 5 6.5l3-3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {expanded && (
        <div className="tool-body">
          {body && <pre className="tool-output tool-input">{body}</pre>}
          {tool.errorText && <p className="tool-error">{tool.errorText}</p>}
          {output && (
            <>
              <p className="label">результат</p>
              <pre className="tool-output">{output}</pre>
            </>
          )}
        </div>
      )}

      {!expanded && tool.state === 'output-error' && tool.errorText && (
        <p className="tool-error-inline">{tool.errorText}</p>
      )}
    </div>
  );
}

function ApprovalCard({
  toolName,
  input,
  reason,
  approvalId,
}: {
  toolName: string;
  input: unknown;
  reason: string | null;
  approvalId: string;
}) {
  const approve = useChatStore((state) => state.approve);
  const text = outputSummary(input);

  return (
    <div className="approval" role="group" aria-label="Требуется разрешение">
      <div className="row">
        <span className="dot dot-busy" />
        <strong>{labelForTool(toolName)}</strong>
        <span className="label">просит разрешение</span>
      </div>

      {text && <pre className="tool-output approval-input">{text}</pre>}
      {reason && <p className="setting-hint">{reason}</p>}

      <div className="row">
        <button type="button" className="btn btn-signal" onClick={() => approve(approvalId, true)}>
          Разрешить
        </button>
        <button type="button" className="btn" onClick={() => approve(approvalId, false)}>
          Отклонить
        </button>
      </div>
    </div>
  );
}

export function Message({ message, last }: { message: UIMessage; last: boolean }) {
  const isUser = message.role === 'user';
  const usage = useChatStore((state) => (last && !isUser ? state.usage : null));

  return (
    <article className={isUser ? 'message message-user' : 'message message-assistant'}>
      <header className="message-head">
        <span className="label">{isUser ? 'вы' : 'модель'}</span>
      </header>

      <div className="message-body stack gap-2">
        {message.parts.map((part, index) => {
          if (isTextUIPart(part)) {
            return isUser ? (
              <p key={`${message.id}-t${index}`} className="message-text">
                {part.text}
              </p>
            ) : (
              <Markdown key={`${message.id}-t${index}`} text={part.text} />
            );
          }

          if (isReasoningUIPart(part)) {
            return (
              <details key={`${message.id}-r${index}`} className="reasoning">
                <summary className="label">ход мысли</summary>
                <p>{part.text}</p>
              </details>
            );
          }

          if (isFileUIPart(part)) {
            const isImage = part.mediaType.startsWith('image/');
            return isImage ? (
              <img
                key={`${message.id}-f${index}`}
                className="message-image"
                src={part.url}
                alt={part.filename ?? 'вложение'}
                loading="lazy"
              />
            ) : (
              <span key={`${message.id}-f${index}`} className="attachment">
                {part.filename ?? part.mediaType}
              </span>
            );
          }

          if (isToolUIPart(part)) {
            const tool = asToolPart(part);

            if (tool.state === 'approval-requested' && tool.approval) {
              return (
                <ApprovalCard
                  key={`${message.id}-a${index}`}
                  approvalId={tool.approval.id}
                  toolName={tool.type?.replace(/^tool-/, '') ?? 'tool'}
                  input={tool.input}
                  reason={tool.approval.requestReason ?? null}
                />
              );
            }

            return <ToolCard key={`${message.id}-c${index}`} part={part} />;
          }

          return null;
        })}
      </div>

      {!isUser && usage && (
        <footer className="message-meta">
          <span className="chip" title="Токены: вход → выход">
            {tokens(usage.inputTokens)} → {tokens(usage.outputTokens)}
          </span>
          <span className="chip" title="Время ответа">
            {duration(usage.durationMs)}
          </span>
          {usage.timeToFirstChunkMs !== null && (
            <span className="chip" title="Время до первого байта">
              старт {duration(usage.timeToFirstChunkMs)}
            </span>
          )}
          {usage.attempts > 1 && <span className="chip chip-signal">попыток: {usage.attempts}</span>}
        </footer>
      )}
    </article>
  );
}
