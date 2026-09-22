import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { common } from 'lowlight';

const options = {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [[rehypeHighlight, { languages: common, detect: true, ignoreMissing: true }]] as never,
};

const components = {
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    const external = href?.startsWith('http');
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer noopener' : undefined}
      >
        {children}
      </a>
    );
  },
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown {...options} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
