const request = require('supertest');
const app = require('./index');

jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

const { Pool } = require('pg');
const pool = new Pool();

describe('Backend API', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/items returns list', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test Item' }] });
    const res = await request(app).get('/api/items');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/items creates item', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2, name: 'New Item' }] });
    const res = await request(app).post('/api/items').send({ name: 'New Item' });
    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('New Item');
  });

  it('POST /api/items returns 400 without name', async () => {
    const res = await request(app).post('/api/items').send({});
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /api/items/:id deletes item', async () => {
    pool.query.mockResolvedValueOnce({});
    const res = await request(app).delete('/api/items/1');
    expect(res.statusCode).toBe(204);
  });
});
