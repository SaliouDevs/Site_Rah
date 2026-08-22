const missingTableError = {
  code: 'PGRST205',
  message: "Could not find the table 'public.exam_series' in the schema cache",
  details: null,
  hint: null
};

const calls = {
  reads: [],
  writes: [],
  rpc: []
};

const cmsTables = new Set([
  'exam_series',
  'exam_series_versions',
  'exam_questions',
  'exam_question_versions',
  'exam_question_choices'
]);

function resultFor(table, query) {
  calls.reads.push({ table, filters: { ...query.filters } });

  if (cmsTables.has(table)) {
    return { data: null, count: null, error: missingTableError };
  }

  if (table === 'exam_settings') {
    return {
      data: [
        { exam_key: 'light', status: 'online' },
        { exam_key: 'heavy', status: 'verification' }
      ],
      error: null
    };
  }

  if (table === 'exam_question_images') {
    return {
      data: [
        {
          question_id: 'PL-001',
          exam_key: 'light',
          series_id: 'B1',
          storage_path: 'light/PL-001/mock.webp'
        }
      ],
      error: null
    };
  }

  if (table === 'profiles') {
    return { data: [], count: 0, error: null };
  }

  return { data: [], count: 0, error: null };
}

function tableQuery(table) {
  const query = {
    filters: {},
    select() { return this; },
    eq(column, value) {
      this.filters[column] = value;
      return this;
    },
    in(column, value) {
      this.filters[column] = value;
      return this;
    },
    not(column, operator, value) {
      this.filters[column] = `${operator}.${value}`;
      return this;
    },
    order() { return this; },
    single() {
      const res = resultFor(table, this);
      return Promise.resolve({ ...res, data: Array.isArray(res.data) ? res.data[0] || null : res.data });
    },
    update(payload) {
      calls.writes.push({ table, method: 'update', payload });
      return this;
    },
    insert(payload) {
      calls.writes.push({ table, method: 'insert', payload });
      return this;
    },
    upsert(payload) {
      calls.writes.push({ table, method: 'upsert', payload });
      return this;
    },
    delete() {
      calls.writes.push({ table, method: 'delete' });
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(resultFor(table, this)).then(resolve, reject);
    }
  };
  return query;
}

function createElementMock() {
  return {
    innerHTML: '',
    style: {},
    dataset: {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
}

const listContainer = createElementMock();
const editorContainer = createElementMock();
const cmsContainer = {
  querySelector(selector) {
    if (selector === '#cms-exams-list') return listContainer;
    if (selector === '#cms-question-editor') return editorContainer;
    return null;
  },
  querySelectorAll() { return []; }
};

globalThis.window = {
  sb: {
    from: tableQuery,
    rpc(name, payload) {
      calls.rpc.push({ name, payload });
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from() {
        return {
          getPublicUrl(storagePath) {
            return { data: { publicUrl: `https://mock.supabase.test/${storagePath}` } };
          },
          upload() {
            calls.writes.push({ table: 'storage', method: 'upload' });
            return Promise.resolve({ data: null, error: null });
          },
          remove() {
            calls.writes.push({ table: 'storage', method: 'remove' });
            return Promise.resolve({ data: null, error: null });
          }
        };
      }
    }
  },
  normalizeExamId: (value) => String(value || '').toLowerCase(),
  EXAMS_CONFIG: {},
  dispatchEvent() {}
};

globalThis.document = {
  querySelector(selector) {
    return selector === '.cms-exams-section' ? cmsContainer : null;
  }
};

function ok(name, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!passed) process.exitCode = 1;
}

const { getExamDataSource, loadStudentExamData } = await import('../assets/js/services/exam-cms-service.js');
const { initCMSExams } = await import('../assets/js/admin/admin-cms-exams.js');
const { loadExamSettings, loadExamImageOverrides } = await import('../assets/js/services/exam-service.js');

const lightSource = await getExamDataSource('light');
ok('Light missing CMS tables selects legacy', lightSource.source === 'legacy', `${lightSource.source}: ${lightSource.reason}`);
ok('Light missing CMS reason is backend unavailable', lightSource.reason === 'CMS backend unavailable', lightSource.reason);

const light = await loadStudentExamData('light');
ok('Light missing CMS loads legacy data', light.source === 'legacy' && light.data?.series?.length === 12, `${light.source}`);

const heavy = await loadStudentExamData('heavy');
ok('Heavy missing CMS loads legacy data', heavy.source === 'legacy' && heavy.data?.series?.length === 5, `${heavy.source}`);

const settings = await loadExamSettings({ force: true });
ok('Old exam availability settings still load', settings.some((row) => row.exam_key === 'light' && row.status === 'online'));

const overrides = await loadExamImageOverrides('light', { force: true });
ok('Old exam image overrides still load', overrides.get('PL-001')?.storage_path === 'light/PL-001/mock.webp');

await initCMSExams('light');
ok('Admin CMS section shows clean unavailable state', listContainer.innerHTML.includes('Gestion de contenu indisponible pour le moment'), listContainer.innerHTML);
ok('Admin CMS section hides Supabase internals', !/PGRST|schema cache|exam_series|Could not find/i.test(listContainer.innerHTML), listContainer.innerHTML);

ok('CMS RPCs are not called automatically', calls.rpc.length === 0, JSON.stringify(calls.rpc));
ok('No writes are triggered during absent CMS fallback/load', calls.writes.length === 0, JSON.stringify(calls.writes));
