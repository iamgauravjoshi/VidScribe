const API_URL = 'http://localhost:8000/api';

export async function processVideo(url: string) {
  const response = await fetch(`${API_URL}/videos/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error('Failed to process video');
  }

  return response.json();
}

export async function askQuestion(videoId: number, message: string) {
  const response = await fetch(`${API_URL}/videos/${videoId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question: message }),
  });

  if (!response.ok) {
    throw new Error('Failed to get answer');
  }

  return response.json();
}
