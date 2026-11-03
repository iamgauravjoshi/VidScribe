import { ArrowRight, Check, MessageSquareText, Search } from 'lucide-react';
import { BrandMark } from './BrandMark';
import './MarketingSite.css';

const transcript = [
  {
    time: '02:16',
    text: 'I try not to jump in while the other person is still making their point.',
  },
  {
    time: '03:42',
    text: 'If I leave a pause, I am more likely to hear what they actually meant.',
    active: true,
  },
  {
    time: '04:08',
    text: 'Then I can answer what they said instead of what I assumed.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Add a video',
    description: 'Paste a public YouTube link with captions.',
  },
  {
    number: '02',
    title: 'Find the passage',
    description: 'Search the transcript or ask a question about it.',
  },
  {
    number: '03',
    title: 'Return to the moment',
    description: 'Open a citation at its timestamp or export the transcript.',
  },
];

export function MarketingSite() {
  return (
    <main className="marketing-site" id="top">
      <header className="site-header">
        <a aria-label="VidScribe home" className="site-brand" href="/">
          <BrandMark className="site-brand-mark" />
          <span>VidScribe</span>
        </a>

        <nav aria-label="Main navigation" className="site-navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
        </nav>

        <a className="site-header-link" href="/library">
          Open library <ArrowRight aria-hidden="true" size={16} />
        </a>
      </header>

      <section aria-labelledby="site-title" className="site-hero">
        <div className="site-hero-copy">
          <p className="site-eyebrow">YouTube video notes</p>
          <h1 id="site-title">Find the moment. Keep the context.</h1>
          <p className="site-intro">
            Paste a public YouTube link. Search the captions, ask about a moment, and jump to the
            timestamp when you want to hear it again.
          </p>
          <div className="site-hero-actions">
            <a className="site-button-primary" href="/library">
              Open your library <ArrowRight aria-hidden="true" size={17} />
            </a>
            <a className="site-quiet-link" href="#how-it-works">
              See how it works
            </a>
          </div>
          <p className="site-requirement">
            <Check aria-hidden="true" size={15} />
            Public YouTube videos with captions
          </p>
        </div>

        <figure aria-label="Example VidScribe source workspace" className="workspace-preview">
          <div className="preview-chrome">
            <div className="preview-brand">
              <BrandMark className="preview-brand-mark" />
              <span>VidScribe</span>
              <span className="preview-divider">/</span>
              <span className="preview-section-label">Source workspace</span>
            </div>
            <span className="preview-ready"><span /> Transcript ready</span>
          </div>

          <div className="preview-source">
            <span className="preview-overline">EXAMPLE SOURCE · YOUTUBE</span>
            <h2>A conversation about listening</h2>
            <p>18:42 <span>·</span> English captions</p>
          </div>

          <div className="preview-columns">
            <section aria-label="Example transcript" className="preview-transcript">
              <div className="preview-panel-heading">
                <h3>Transcript</h3>
                <Search aria-hidden="true" size={15} />
              </div>
              {transcript.map(({ time, text, active }) => (
                <div className={`transcript-row${active ? ' transcript-row-active' : ''}`} key={time}>
                  <time>{time}</time>
                  <p>{text}</p>
                </div>
              ))}
            </section>

            <section aria-label="Example answer and citation" className="preview-answer">
              <div className="preview-panel-heading">
                <h3>Ask this video</h3>
                <MessageSquareText aria-hidden="true" size={15} />
              </div>
              <p className="preview-question">How do you avoid interrupting?</p>
              <p className="preview-response">
                Let the speaker finish, then take a beat before replying.
              </p>
              <div className="preview-citation-label">SOURCE MOMENT</div>
              <div className="preview-citation">
                <span>03:42</span>
                <span>If I leave a pause, I am more likely to hear what they meant.</span>
                <ArrowRight aria-hidden="true" size={14} />
              </div>
            </section>
          </div>

          <figcaption>Example content · workspace preview for illustration</figcaption>
        </figure>
      </section>

      <div aria-label="VidScribe capabilities" className="capability-line">
        <span>Search captions</span>
        <span>Ask about a source</span>
        <span>Follow timestamped citations</span>
        <span>Export transcripts</span>
      </div>

      <section aria-labelledby="how-title" className="workflow-section" id="how-it-works">
        <div className="workflow-intro">
          <p className="site-eyebrow">How it works</p>
          <h2 id="how-title">From video link to exact moment.</h2>
          <p>
            Add a video, find a phrase or ask a question, then follow the timestamp back to the
            source.
          </p>
        </div>

        <ol className="workflow-list">
          {steps.map(({ number, title, description }) => (
            <li key={number}>
              <span className="workflow-number">{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <ArrowRight aria-hidden="true" size={17} />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="privacy-title" className="privacy-section" id="privacy">
        <div className="privacy-copy">
          <p className="site-eyebrow">Your sources, your settings</p>
          <h2 id="privacy-title">Your transcript stays on your computer.</h2>
          <p>
            VidScribe stores transcript text and search data in your local PostgreSQL database.
            If you choose a cloud model, your question and selected passages are sent to that
            provider to generate an answer.
          </p>
        </div>

        <div className="privacy-details">
          <div>
            <span className="privacy-detail-mark"><Check aria-hidden="true" size={15} /></span>
            <p><strong>On your computer</strong><span>Transcript and search</span></p>
          </div>
          <div>
            <span className="privacy-detail-mark privacy-detail-mark-outline"><ArrowRight aria-hidden="true" size={15} /></span>
            <p><strong>Sent to your chosen model</strong><span>Question and selected passages</span></p>
          </div>
        </div>
      </section>

      <section className="site-endcap">
        <div>
          <p className="site-eyebrow">Ready for the next video?</p>
          <h2>Save it while it is still on your mind.</h2>
        </div>
        <a className="site-button-primary" href="/library">
          Open VidScribe <ArrowRight aria-hidden="true" size={17} />
        </a>
      </section>

      <footer className="site-footer">
        <a aria-label="VidScribe home" className="site-brand site-footer-brand" href="/">
          <BrandMark className="site-brand-mark" />
          <span>VidScribe</span>
        </a>
        <span>Keep the video. Keep your place in it.</span>
        <a className="site-footer-top" href="#top">Back to top</a>
      </footer>
    </main>
  );
}
