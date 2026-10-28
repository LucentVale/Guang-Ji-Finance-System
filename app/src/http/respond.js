// Membaca request body dan menulis response.
const { AppError, badRequest } = require('../lib/errors');

const FILE = Symbol('file');
const STATUS = Symbol('status');

/** Bentuk khusus hasil handler. */
const reply = {
  file: (buffer, fileName, contentType) => ({ [FILE]: true, buffer, fileName, contentType }),
  created: (data) => ({ [STATUS]: 201, data }),
};

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  binary: 'application/octet-stream',
};

function readRawBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new AppError(413, 'File terlalu besar'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limitBytes) {
  const raw = await readRawBody(req, limitBytes);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { throw badRequest('Format data (JSON) tidak valid'); }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendResult(res, result) {
  if (result?.[FILE]) {
    res.writeHead(200, {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      'Cache-Control': 'no-store',
    });
    return res.end(result.buffer);
  }
  if (result?.[STATUS]) return sendJson(res, result[STATUS], result.data);
  return sendJson(res, 200, result ?? { ok: true });
}

function sendError(res, err) {
  if (err instanceof AppError) return sendJson(res, err.status, { error: err.message });
  console.error(err);
  return sendJson(res, 500, { error: `Terjadi kesalahan pada server: ${err.message}` });
}

module.exports = { reply, MIME, readRawBody, readJsonBody, sendJson, sendResult, sendError };
