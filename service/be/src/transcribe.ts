import http from 'http';

export function transcribe(audioBuffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 9876,
      method: 'POST',
      headers: { 'Content-Length': audioBuffer.length },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result.text || '');
        } catch {
          reject(new Error('Invalid response from whisper'));
        }
      });
    });

    req.on('error', (err) => reject(new Error('Whisper server not ready: ' + err.message)));
    req.write(audioBuffer);
    req.end();
  });
}
