import { execSync } from 'child_process';
import http from 'http';
import https from 'https';

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }));
const url = status.API_URL;
if (!url || (!url.includes('127.0.0.1') && !url.includes('localhost'))) {
  throw new Error(`Refusing non-local Supabase URL: ${url}`);
}

const config = {
  url,
  anonKey: status.ANON_KEY,
  token: status.SERVICE_ROLE_KEY
};

function request(path) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, config.url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: 'GET',
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${config.token}`,
        accept: 'application/json',
        prefer: 'count=exact'
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        const json = raw ? JSON.parse(raw) : [];
        resolve({ status: res.statusCode, json, headers: res.headers, raw });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function installRestSupabaseMock({ breakCmsRead = false } = {}) {
  globalThis.window = {
    sb: {
      from(table) {
        return {
          select(columns, options = {}) {
            const params = new URLSearchParams();
            params.set('select', columns);
            let path = `/rest/v1/${table}?${params.toString()}`;
            const run = async (nextPath) => {
              if (breakCmsRead && table === 'exam_question_versions' && !options.count) {
                return { data: null, count: null, error: { message: 'simulated CMS read failure' } };
              }
              const res = await request(nextPath);
              const contentRange = res.headers['content-range'] || '';
              const count = contentRange.includes('/') ? Number(contentRange.split('/').pop()) : null;
              return { data: res.json, count, error: res.status >= 400 ? { message: res.raw } : null };
            };
            const api = {
              eq(column, value) {
                const separator = path.includes('?') ? '&' : '?';
                path += `${separator}${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`;
                return {
                  order(orderColumn) {
                    return run(`${path}&order=${encodeURIComponent(orderColumn)}.asc`);
                  },
                  then(resolve, reject) {
                    return run(path).then(resolve, reject);
                  }
                };
              },
              in(column, values) {
                const separator = path.includes('?') ? '&' : '?';
                path += `${separator}${encodeURIComponent(column)}=in.(${values.map(encodeURIComponent).join(',')})`;
                const inApi = {
                  order(orderColumn) {
                    return run(`${path}&order=${encodeURIComponent(orderColumn)}.asc`);
                  },
                  then(resolve, reject) {
                    return run(path).then(resolve, reject);
                  }
                };
                return inApi;
              },
              order(orderColumn) {
                return run(`${path}&order=${encodeURIComponent(orderColumn)}.asc`);
              }
            };
            return api;
          }
        };
      }
    }
  };
}

function ok(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!passed) process.exitCode = 1;
}

installRestSupabaseMock();
const { getExamDataSource, loadStudentExamData } = await import('../assets/js/services/exam-cms-service.js');

const lightSource = await getExamDataSource('light');
const heavySource = await getExamDataSource('heavy');
ok('Light data source completeness', lightSource.source === 'cms', `${lightSource.source}: ${lightSource.reason}`);
ok('Heavy data source completeness', heavySource.source === 'cms', `${heavySource.source}: ${heavySource.reason}`);

const light = await loadStudentExamData('light');
ok('Light loads from CMS', light.source === 'cms', `${light.source}${light.error ? `: ${light.error}` : ''}`);
const lightQuestion = light.data.series.flatMap((series) => series.questions).find((question) => question.id === 'PL-003');
ok('Light question format id/series/text', Boolean(lightQuestion?.id && lightQuestion?.seriesId && lightQuestion?.text), JSON.stringify(lightQuestion));
ok('Light question has correct answer', Boolean(lightQuestion?.correctAnswer || lightQuestion?.type3CorrectAnswer1), lightQuestion?.id);

const heavy = await loadStudentExamData('heavy');
ok('Heavy loads from CMS', heavy.source === 'cms', `${heavy.source}${heavy.error ? `: ${heavy.error}` : ''}`);
const heavyQuestion = heavy.data.series.flatMap((series) => series.questions).find((question) => question.id === 'PLD-001');
ok('Heavy question format id/series/text', Boolean(heavyQuestion?.id && heavyQuestion?.seriesId && heavyQuestion?.text), JSON.stringify(heavyQuestion));

const pld027 = heavy.data.series.flatMap((series) => series.questions).find((question) => question.id === 'PLD-027');
ok('PLD-027 type4_multiple', pld027?.optionType === 'type4_multiple', pld027?.optionType);
ok('PLD-027 has 4 choices', ['type4Text1', 'type4Text2', 'type4Text3', 'type4Text4'].every((key) => pld027?.[key]), JSON.stringify(pld027));
ok('PLD-027 multi-correct B,C,D', Array.isArray(pld027?.correctAnswer) && pld027.correctAnswer.join(',') === 'B,C,D', JSON.stringify(pld027?.correctAnswer));

installRestSupabaseMock({ breakCmsRead: true });
const fallback = await loadStudentExamData('heavy');
ok('CMS read failure before session falls back to legacy', fallback.source === 'legacy' && fallback.data?.series?.length === 5, fallback.source);
