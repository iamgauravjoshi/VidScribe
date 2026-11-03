export type EvaluationQueryStyle = 'lexical' | 'paraphrase' | 'definition';

export interface EvaluationQuery {
  id: string;
  question: string;
  anchorPhrase: string;
  anchorOccurrence?: number;
  style: EvaluationQueryStyle;
}

export interface EvaluationSource {
  title: string;
  topic: string;
  videoId: string;
  queries: EvaluationQuery[];
}

// Each short anchor phrase identifies a human-selected supporting caption
// segment. Keep phrases specific; repeated phrases use an explicit occurrence.
export const REAL_SOURCE_SEARCH_DATASET: { version: number; sources: EvaluationSource[] } = {
  version: 2,
  sources: [
    {
      title: 'A Simple Way to Break a Bad Habit | Judson Brewer | TED',
      topic: 'behavior and psychology',
      videoId: '-moW9jvvMr4',
      queries: [
        {
          id: 'reward-based-habit-learning',
          question: 'How does reward-based learning shape habits?',
          anchorPhrase: 'reward-based learning process',
          anchorOccurrence: 0,
          style: 'lexical',
        },
        {
          id: 'curiosity-and-urges',
          question: 'How can curiosity help change an urge?',
          anchorPhrase: 'supported by curiosity',
          style: 'paraphrase',
        },
        {
          id: 'habit-learning-mechanism',
          question: 'What process reinforces a behavior that feels rewarding?',
          anchorPhrase: 'reward-based learning process',
          anchorOccurrence: 0,
          style: 'paraphrase',
        },
      ],
    },
    {
      title: 'How to Speak So That People Want to Listen | Julian Treasure | TED',
      topic: 'communication',
      videoId: 'eIho2S0ZahI',
      queries: [
        {
          id: 'first-harmful-speech-habit',
          question: 'Which harmful speech habit does Julian list first?',
          anchorPhrase: 'First, gossip',
          style: 'paraphrase',
        },
        {
          id: 'hail-authenticity',
          question: 'What does the A in HAIL stand for?',
          anchorPhrase: 'The A is authenticity',
          style: 'definition',
        },
        {
          id: 'hail-love',
          question: 'What does the L in HAIL represent?',
          anchorPhrase: 'And the L is love',
          style: 'definition',
        },
      ],
    },
    {
      title: 'But what is a neural network? | Deep learning chapter 1',
      topic: 'computer science and mathematics',
      videoId: 'aircAruvnKk',
      queries: [
        {
          id: 'what-neurons-hold',
          question: 'What does 3Blue1Brown say neurons hold?',
          anchorPhrase: 'hold numbers',
          style: 'lexical',
        },
        {
          id: 'connection-weight-assignment',
          question: 'How does a network encode the strength of each connection?',
          anchorPhrase: 'assign a weight',
          style: 'paraphrase',
        },
        {
          id: 'connection-weight-values',
          question: 'What kind of values are the connection weights?',
          anchorPhrase: 'weights are just numbers',
          style: 'lexical',
        },
      ],
    },
    {
      title: 'How great leaders inspire action | Simon Sinek | TED',
      topic: 'leadership and organizations',
      videoId: 'qp0HIF3SfI4',
      queries: [
        {
          id: 'golden-circle-name',
          question: 'What does Sinek call his model for explaining why companies inspire?',
          anchorPhrase: 'call it the golden circle',
          style: 'lexical',
        },
        {
          id: 'innovation-diffusion-law',
          question: 'Which law does Sinek cite when discussing how innovation spreads?',
          anchorPhrase: 'law of diffusion',
          anchorOccurrence: 0,
          style: 'lexical',
        },
        {
          id: 'apple-example-question',
          question: 'What question does Sinek ask about Apple?',
          anchorPhrase: 'Why is Apple so innovative',
          style: 'lexical',
        },
      ],
    },
    {
      title: 'The puzzle of motivation | Dan Pink | TED',
      topic: 'work and motivation',
      videoId: 'rrkrvAUbU9Y',
      queries: [
        {
          id: 'candle-task-name',
          question: 'What name does Pink give the candle task?',
          anchorPhrase: 'called the candle problem',
          style: 'lexical',
        },
        {
          id: 'autonomy-definition',
          question: 'In Pink’s model, what does autonomy mean?',
          anchorPhrase: 'urge to direct our own lives',
          style: 'definition',
        },
        {
          id: 'intrinsic-motivator-list',
          question: 'Which three intrinsic motivators does Pink name?',
          anchorPhrase: 'autonomy, mastery and purpose',
          anchorOccurrence: 0,
          style: 'definition',
        },
      ],
    },
    {
      title: 'Do schools kill creativity? | Sir Ken Robinson | TED',
      topic: 'education and creativity',
      videoId: 'iG9CE55wbtY',
      queries: [
        {
          id: 'school-treatment-of-mistakes',
          question: 'How does Robinson say schools treat mistakes?',
          anchorPhrase: 'stigmatize mistakes',
          style: 'paraphrase',
        },
        {
          id: 'gillian-lynne-company',
          question: 'What did Robinson say Gillian Lynne founded?',
          anchorPhrase: 'Gillian Lynne Dance Company',
          style: 'lexical',
        },
        {
          id: 'human-creativity',
          question: 'What does Robinson call an extraordinary human capacity?',
          anchorPhrase: 'human creativity',
          style: 'lexical',
          anchorOccurrence: 0,
        },
      ],
    },
  ],
};
