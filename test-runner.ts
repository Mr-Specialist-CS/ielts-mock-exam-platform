import { handleApiRequest, runRetentionCleanup } from './src/server/apiHandler';
import { MemoryStorage } from './src/server/storage';
import { mergeSessionPreferringProgress, sectionRank } from './src/utils/sessionMerge';
import { getExamStartMs, EXAM_TIMEZONE_OFFSET_MS } from './src/types';
import {
  getMultiLetters, questionSlots, spanEndNumber, scoreMultiMarks,
  scoreQuestionMarks, normalizeMultiKeys, expandNavSlots, gradeListening,
  mergeConsecutiveMultis, renumberQuestionsWithSlots, countQuestionSlots
} from './src/utils/ieltsScoring';
import { consolidateTableGroups } from './src/components/Admin/ListeningImportModal';
import { parseParagraphLabels, letterRangeBank, synthesizeParagraphBanks } from './src/utils/matchingBank';

async function runTests() {
  console.log('🚀 Running IELTS Gate Comprehensive Security & Cloudflare Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  const storage = new MemoryStorage(true);
  const mockEnv = {
    ADMIN_USERNAME: 'proctor_admin',
    ADMIN_PASSWORD: 'SuperSecretAdminKey123!#',
    APP_URL: 'https://ieltsgate.test'
  };

  // 1. Health endpoint
  {
    const req = new Request('https://ieltsgate.test/api/health', { method: 'GET' });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    assert(res.status === 200 && data.status === 'ok', 'GET /api/health returns 200 ok');
  }

  // 2. Admin Login - Missing environment credentials fails safely
  {
    const emptyEnv = {};
    const req = new Request('https://ieltsgate.test/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password' })
    });
    const res = await handleApiRequest(req, storage, emptyEnv);
    const data = await res.json();
    assert(res.status === 503 && data.error.includes('credentials are not configured'), 'Admin login fails safely (503) if secrets not set');
  }

  // 3. Admin Login - Invalid credentials rejected with 401
  {
    const req = new Request('https://ieltsgate.test/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'proctor_admin', password: 'WrongPassword!' })
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    assert(res.status === 401 && data.success === false, 'Admin login with wrong password rejected with 401');
  }

  // 4. Admin Login - Valid credentials returns token
  let adminToken = '';
  {
    const req = new Request('https://ieltsgate.test/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'proctor_admin', password: 'SuperSecretAdminKey123!#' })
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    adminToken = data.token;
    assert(res.status === 200 && data.success === true && Boolean(adminToken), 'Admin login with valid credentials succeeds and issues token');
  }

  // 5. Admin Verify - Valid token
  {
    const req = new Request('https://ieltsgate.test/api/admin/verify', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    assert(res.status === 200 && data.authenticated === true, 'GET /api/admin/verify with valid Bearer token returns authenticated');
  }

  // 6. Admin Verify - Invalid / forged token
  {
    const req = new Request('https://ieltsgate.test/api/admin/verify', {
      method: 'GET',
      headers: { Authorization: 'Bearer forged-invalid-token-12345' }
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    assert(res.status === 401, 'GET /api/admin/verify with forged token rejected with 401');
  }

  // 7. Admin Authorization Enforcement on Mutations
  {
    // A. Exams mutation without auth
    const reqExam = new Request('https://ieltsgate.test/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hacked Exam' })
    });
    const resExam = await handleApiRequest(reqExam, storage, mockEnv);
    assert(resExam.status === 401, 'POST /api/exams without admin token rejected with 401');

    // B. Sessions list without auth
    const reqSess = new Request('https://ieltsgate.test/api/sessions', { method: 'GET' });
    const resSess = await handleApiRequest(reqSess, storage, mockEnv);
    assert(resSess.status === 401, 'GET /api/sessions without admin token rejected with 401');

    // C. Registration approval without auth
    const reqApprove = new Request('https://ieltsgate.test/api/registrations/REG-628104/approve', { method: 'POST' });
    const resApprove = await handleApiRequest(reqApprove, storage, mockEnv);
    assert(resApprove.status === 401, 'POST /api/registrations/:id/approve without admin token rejected with 401');

    // D. Writing grading without auth
    const reqWriting = new Request('https://ieltsgate.test/api/grading/IG-772104/writing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overallBand: 9.0 })
    });
    const resWriting = await handleApiRequest(reqWriting, storage, mockEnv);
    assert(resWriting.status === 401, 'POST /api/grading/:id/writing without admin token rejected with 401');

    // E. Speaking grading without auth
    const reqSpeaking = new Request('https://ieltsgate.test/api/grading/IG-772104/speaking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overallBand: 9.0 })
    });
    const resSpeaking = await handleApiRequest(reqSpeaking, storage, mockEnv);
    assert(resSpeaking.status === 401, 'POST /api/grading/:id/speaking without admin token rejected with 401');

    // F. Lock reset without auth
    const reqUnlock = new Request('https://ieltsgate.test/api/sessions/IG-410529/reset-lock', { method: 'POST' });
    const resUnlock = await handleApiRequest(reqUnlock, storage, mockEnv);
    assert(resUnlock.status === 401, 'POST /api/sessions/:id/reset-lock without admin token rejected with 401');
  }

  // 8. Admin Mutations Allowed With Valid Admin Token
  {
    const reqSess = new Request('https://ieltsgate.test/api/sessions', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const resSess = await handleApiRequest(reqSess, storage, mockEnv);
    assert(resSess.status === 200, 'GET /api/sessions WITH valid admin token returns 200');

    // Admin creates an exam form
    const createdExamId = `exam-test-${Date.now()}`;
    const reqExam = new Request('https://ieltsgate.test/api/exams', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        id: createdExamId,
        code: 'IELTS-AC-2026-TEST',
        title: 'IELTS Academic Practice Test 99',
        type: 'academic',
        description: 'Automated test simulation form',
        centreNumber: 'AZ001'
      })
    });
    const resExam = await handleApiRequest(reqExam, storage, mockEnv);
    assert(resExam.status === 201, 'POST /api/exams WITH valid admin token returns 201 Created');
    const examData = await resExam.json();
    assert(examData.success === true && examData.exam.id === createdExamId, 'Created exam returned in response');

    // Verify created exam appears in catalog
    const reqCatalog = new Request('https://ieltsgate.test/api/exams', { method: 'GET' });
    const resCatalog = await handleApiRequest(reqCatalog, storage, mockEnv);
    assert(resCatalog.status === 200, 'GET /api/exams returns 200');
    const catalogList = await resCatalog.json();
    assert(catalogList.some((e: any) => e.id === createdExamId), 'Created exam appears in exams catalog');
  }

  // 9. File Upload - Image upload generates persistent R2 key & URL
  let uploadedFileUrl = '';
  let uploadedReceiptUrl = '';
  {
    // Small 1x1 GIF / JPEG sample
    const sampleImageBase64 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const req = new Request('https://ieltsgate.test/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileData: sampleImageBase64,
        fileName: 'candidate-avatar.gif',
        uploadType: 'photo'
      })
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    uploadedFileUrl = data.url;
    assert(
      res.status === 201 &&
      data.success === true &&
      data.url.startsWith('/api/files/photos/') &&
      data.key.startsWith('photos/'),
      'POST /api/upload stores image and returns /api/files/photos/... key'
    );
  }

  // 10. File Upload - Private receipt upload
  {
    const sampleReceiptBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const req = new Request('https://ieltsgate.test/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileData: sampleReceiptBase64,
        fileName: 'payment-m10.jpg',
        uploadType: 'receipt'
      })
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    uploadedReceiptUrl = data.url;
    assert(
      res.status === 201 &&
      data.url.startsWith('/api/files/receipts/') &&
      data.key.startsWith('receipts/'),
      'POST /api/upload categorizes receipt into private receipts/ folder'
    );
  }

  // 11. File Upload - Reject malicious or unsupported MIME types
  {
    const req = new Request('https://ieltsgate.test/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileData: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        fileName: 'exploit.html',
        uploadType: 'general'
      })
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    assert(res.status === 400, 'POST /api/upload rejects executable/html MIME types with 400');
  }

  // 12. File Access Gate - Public photo access allowed
  {
    const req = new Request(`https://ieltsgate.test${uploadedFileUrl}`, { method: 'GET' });
    const res = await handleApiRequest(req, storage, mockEnv);
    assert(
      res.status === 200 &&
      res.headers.get('X-Content-Type-Options') === 'nosniff',
      'GET /api/files/photos/... serves photo with nosniff header'
    );
  }

  // 13. File Access Gate - Private receipt access without auth rejected
  {
    const req = new Request(`https://ieltsgate.test${uploadedReceiptUrl}`, { method: 'GET' });
    const res = await handleApiRequest(req, storage, mockEnv);
    assert(res.status === 401, 'GET /api/files/receipts/... without admin token rejected with 401');
  }

  // 14. File Access Gate - Private receipt access WITH admin token allowed
  {
    const req = new Request(`https://ieltsgate.test${uploadedReceiptUrl}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    assert(res.status === 200, 'GET /api/files/receipts/... WITH admin token allowed with 200');
  }

  // 14c. File Access Gate - Private receipt access WITH query param ?token=... (for <img> tags in admin)
  {
    const req = new Request(`https://ieltsgate.test${uploadedReceiptUrl}?token=${encodeURIComponent(adminToken)}`, {
      method: 'GET'
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    assert(res.status === 200, 'GET /api/files/receipts/... WITH ?token= query parameter allowed with 200');
  }

  // 14d. System Settings - Public read and Admin write (Admin defines price, phone, holder)
  {
    const getReq = new Request('https://ieltsgate.test/api/settings', { method: 'GET' });
    const getRes = await handleApiRequest(getReq, storage, mockEnv);
    const getData = await getRes.json();
    assert(getRes.status === 200, 'GET /api/settings returns 200 status');

    const postReq = new Request('https://ieltsgate.test/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        examPriceAzn: 55,
        m10PhoneNumber: '+994 50 111 22 33',
        m10AccountHolder: 'IELTS Gate Center'
      })
    });
    const postRes = await handleApiRequest(postReq, storage, mockEnv);
    const postData = await postRes.json();
    assert(postRes.status === 200 && postData.settings.examPriceAzn === 55, 'POST /api/settings allows admin to update exam price and m10 details');

    // Subsequent GET returns the newly defined settings
    const verifyReq = new Request('https://ieltsgate.test/api/settings', { method: 'GET' });
    const verifyRes = await handleApiRequest(verifyReq, storage, mockEnv);
    const verifyData = await verifyRes.json();
    assert(verifyData.isConfigured === true && verifyData.examPriceAzn === 55 && verifyData.m10PhoneNumber === '+994 50 111 22 33', 'Subsequent GET returns admin-defined settings');
  }

  // 14d-2. Active Exam Admin Management (Requirement 11)
  {
    // A. Without admin token rejected
    const unauthReq = new Request('https://ieltsgate.test/api/admin/active-exam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeExamId: 'exam-ielts-academic-101' })
    });
    const unauthRes = await handleApiRequest(unauthReq, storage, mockEnv);
    assert(unauthRes.status === 401, 'POST /api/admin/active-exam without admin token rejected with 401');

    // B. With admin token sets active exam
    const setReq = new Request('https://ieltsgate.test/api/admin/active-exam', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ activeExamId: 'exam-ielts-academic-101' })
    });
    const setRes = await handleApiRequest(setReq, storage, mockEnv);
    const setData = await setRes.json();
    assert(setRes.status === 200 && setData.activeExamId === 'exam-ielts-academic-101', 'Admin can set active exam');

    // C. Admin can choose no exam to be active
    const noneReq = new Request('https://ieltsgate.test/api/admin/active-exam', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ activeExamId: 'none' })
    });
    const noneRes = await handleApiRequest(noneReq, storage, mockEnv);
    const noneData = await noneRes.json();
    assert(noneRes.status === 200 && noneData.activeExamId === null && noneData.message === 'Currently, there is not an active exam', 'Admin can set no active exam ("Currently, there is not an active exam")');
  }

  // 14d-3. Exam Access Schedule (open-exam / close-exam / exam-schedule)
  {
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };

    // A. Without admin token rejected
    const unauthRes = await handleApiRequest(
      new Request('https://ieltsgate.test/api/admin/close-exam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      storage, mockEnv
    );
    assert(unauthRes.status === 401, 'POST /api/admin/close-exam without admin token rejected with 401');

    // B. Open exam immediately
    const openRes = await handleApiRequest(
      new Request('https://ieltsgate.test/api/admin/open-exam', { method: 'POST', headers: adminHeaders, body: '{}' }),
      storage, mockEnv
    );
    const openData = await openRes.json();
    assert(openRes.status === 200 && openData.settings?.examAccessMode === 'open' && !!openData.settings?.examOpenedAt, 'POST /api/admin/open-exam sets examAccessMode to open');

    // C. Persisted in GET /api/settings
    const settingsRes = await handleApiRequest(new Request('https://ieltsgate.test/api/settings', { method: 'GET' }), storage, mockEnv);
    const settingsData = await settingsRes.json();
    assert(settingsData.examAccessMode === 'open', 'GET /api/settings reflects open exam access mode');

    // D. Close exam immediately
    const closeRes = await handleApiRequest(
      new Request('https://ieltsgate.test/api/admin/close-exam', { method: 'POST', headers: adminHeaders, body: '{}' }),
      storage, mockEnv
    );
    const closeData = await closeRes.json();
    assert(closeRes.status === 200 && closeData.settings?.examAccessMode === 'closed', 'POST /api/admin/close-exam sets examAccessMode to closed');

    // E. Schedule with valid datetime
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const schedRes = await handleApiRequest(
      new Request('https://ieltsgate.test/api/admin/exam-schedule', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ examAccessMode: 'scheduled', examScheduledAt: futureIso }) }),
      storage, mockEnv
    );
    const schedData = await schedRes.json();
    assert(schedRes.status === 200 && schedData.settings?.examAccessMode === 'scheduled' && schedData.settings?.examScheduledAt === futureIso, 'POST /api/admin/exam-schedule stores scheduled mode and datetime');

    // F. Invalid mode rejected
    const badModeRes = await handleApiRequest(
      new Request('https://ieltsgate.test/api/admin/exam-schedule', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ examAccessMode: 'bogus' }) }),
      storage, mockEnv
    );
    assert(badModeRes.status === 400, 'POST /api/admin/exam-schedule rejects invalid examAccessMode with 400');

    // G. Scheduled without datetime rejected
    const noDateRes = await handleApiRequest(
      new Request('https://ieltsgate.test/api/admin/exam-schedule', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ examAccessMode: 'scheduled' }) }),
      storage, mockEnv
    );
    assert(noDateRes.status === 400, 'POST /api/admin/exam-schedule rejects scheduled mode without examScheduledAt with 400');

    // Reset to open so later candidate-flow tests are unaffected
    // (the entry gate enforces the schedule on sync/submit).
    await handleApiRequest(
      new Request('https://ieltsgate.test/api/admin/open-exam', { method: 'POST', headers: adminHeaders, body: '{}' }),
      storage, mockEnv
    );
  }

  // 14e. Registration Submission - Validation Failures
  {
    const failReq1 = new Request('https://ieltsgate.test/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateName: '', m10ReceiptUrl: 'https://example.com/receipt.jpg' })
    });
    const failRes1 = await handleApiRequest(failReq1, storage, mockEnv);
    assert(failRes1.status === 400, 'Registration submission without candidateName rejected with 400');

    const failReq2 = new Request('https://ieltsgate.test/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateName: 'John Doe', m10ReceiptUrl: '' })
    });
    const failRes2 = await handleApiRequest(failReq2, storage, mockEnv);
    assert(failRes2.status === 400, 'Registration submission without receipt rejected with 400');
  }

  // 14f. Registration Submission - Successful creation with REG reference number
  let createdRegId = '';
  {
    const regReq = new Request('https://ieltsgate.test/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateName: 'Aysel Mammadova',
        phone: '+994 50 555 44 33',
        email: 'aysel@example.az',
        m10ReceiptUrl: 'https://ieltsgate.test/api/files/receipts/test-receipt.jpg',
        m10TransactionId: 'M10-88392110',
        amountAzn: 55
      })
    });
    const regRes = await handleApiRequest(regReq, storage, mockEnv);
    const regData = await regRes.json();
    assert(regRes.status === 201, 'POST /api/registrations returns 201 Created');
    assert(regData.success === true, 'Response contains success flag');
    const returnedId = regData.id || regData.request?.id;
    assert(typeof returnedId === 'string' && returnedId.startsWith('REG-'), `Response returns valid REG number: ${returnedId}`);
    createdRegId = returnedId;

    // Public lookup by REG reference number
    const lookupReq = new Request(`https://ieltsgate.test/api/registrations/${createdRegId}`, { method: 'GET' });
    const lookupRes = await handleApiRequest(lookupReq, storage, mockEnv);
    const lookupData = await lookupRes.json();
    assert(lookupRes.status === 200 && lookupData.id === createdRegId, 'Candidate can lookup registration status using REG reference number');
  }

  // 15. Candidate Session - Public candidate session query allowed
  {
    const req = new Request('https://ieltsgate.test/api/sessions/IG-772104', { method: 'GET' });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    assert(res.status === 200 && data.candidateId === 'IG-772104', 'Candidate can fetch their own session via candidate ID');
  }

  // 16. Candidate Session Sync - Candidate updates answers safely
  {
    const req = new Request('https://ieltsgate.test/api/sessions/IG-772104/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listeningState: { answers: { 'q1': 'park' } },
        currentSection: 'listening'
      })
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    assert(
      res.status === 200 &&
      data.session.listeningState.answers['q1'] === 'park',
      'Candidate can sync exam answers to session state'
    );
  }

  // 17. Section Submission & Authoritative Scoring
  {
    const req = new Request('https://ieltsgate.test/api/sessions/IG-772104/submit-section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'listening' })
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    assert(
      res.status === 200 &&
      data.session.currentSection === 'reading' &&
      data.session.grading.listeningScore !== undefined,
      'Submitting section authoritatively grades component and advances module'
    );
  }

  // 18. Exam Finalization - Student submit never certifies; admin finalize does.
  // Student submit marks completion and auto-grades L/R, but the overall band
  // stays uncertified until BOTH examiner confirmations exist + admin finalizes.
  {
    const req = new Request('https://ieltsgate.test/api/sessions/IG-772104/submit', { method: 'POST' });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    assert(
      res.status === 200 &&
      data.session.status === 'completed' &&
      data.finalized === false &&
      data.session.grading.isFinalized !== true,
      'Student exam submit completes without certifying the overall band'
    );

    // Examiner confirmations (admin): writing + speaking.
    const reqWriting = new Request('https://ieltsgate.test/api/sessions/IG-772104/finalize-writing-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ overallBand: 7.0 })
    });
    const resWriting = await handleApiRequest(reqWriting, storage, mockEnv);
    assert(resWriting.status === 200, 'Admin examiner confirms writing band');

    const reqSpeaking = new Request('https://ieltsgate.test/api/sessions/IG-772104/grade-speaking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ overallBand: 7.0 })
    });
    const resSpeaking = await handleApiRequest(reqSpeaking, storage, mockEnv);
    assert(resSpeaking.status === 200, 'Admin examiner confirms speaking band');

    // Admin finalize certifies the rounded overall band + CEFR.
    const reqFinalize = new Request('https://ieltsgate.test/api/sessions/IG-772104/finalize-exam', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const resFinalize = await handleApiRequest(reqFinalize, storage, mockEnv);
    const dataFinalize = await resFinalize.json();
    assert(
      resFinalize.status === 200 &&
      dataFinalize.session.grading.isFinalized === true &&
      typeof dataFinalize.session.grading.finalOverallBand === 'number' &&
      typeof dataFinalize.session.grading.cefrLevel === 'string',
      'Exam submission authoritatively calculates rounded overall band and CEFR'
    );
  }

  // 19. Public Verification Privacy (Phases 9 & 10)
  {
    const req = new Request('https://ieltsgate.test/api/verify/IG-772104', { method: 'GET' });
    const res = await handleApiRequest(req, storage, mockEnv);
    const data = await res.json();
    assert(
      res.status === 200 &&
      data.verified === true &&
      data.scores !== undefined &&
      data.idDocumentNumber === undefined &&
      data.firstLanguage === undefined,
      'Public verification omits sensitive National ID and firstLanguage PII'
    );
  }

  // 19b. Exact IG match: a partial/shortened candidate number must NOT resolve.
  // (Regression: IG-34567 must never open IG-345678's session.)
  {
    const full = await handleApiRequest(new Request('https://ieltsgate.test/api/sessions/IG-772104', { method: 'GET' }), storage, mockEnv);
    assert(full.status === 200, 'Full candidate ID IG-772104 resolves its session');
    for (const partial of ['IG-77210', 'IG-72104', '77210', 'IG-7721044']) {
      const res = await handleApiRequest(new Request(`https://ieltsgate.test/api/sessions/${partial}`, { method: 'GET' }), storage, mockEnv);
      assert(res.status === 404, `Partial candidate ID ${partial} is rejected with 404`);
    }
  }

  // 19c. Deleted exams stay deleted: no resurrection via single-GET fallback or list.
  {
    const createReq = new Request('https://ieltsgate.test/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ id: 'exam-test-delete-me', code: 'DEL-1', title: 'Delete Me Exam', type: 'academic' })
    });
    const createRes = await handleApiRequest(createReq, storage, mockEnv);
    assert(createRes.status === 201, 'Setup: temp exam created for delete test');
    const delReq = new Request('https://ieltsgate.test/api/exams/exam-test-delete-me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const delRes = await handleApiRequest(delReq, storage, mockEnv);
    assert(delRes.status === 200, 'DELETE /api/exams/:id removes the exam');
    const listRes = await handleApiRequest(new Request('https://ieltsgate.test/api/exams', { method: 'GET' }), storage, mockEnv);
    const list = await listRes.json();
    assert(Array.isArray(list) && !list.some((e: any) => e && e.id === 'exam-test-delete-me'), 'Deleted exam is absent from catalog after delete');
    const singleRes = await handleApiRequest(new Request('https://ieltsgate.test/api/exams/exam-test-delete-me', { method: 'GET' }), storage, mockEnv);
    assert(singleRes.status === 404, 'GET deleted exam returns 404 (no fallback resurrection)');
  }

  // 19d. Global answer edit applies, recalculates, saves + reports count.
  {
    const syncReq = new Request('https://ieltsgate.test/api/sessions/IG-772104/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listeningState: { answers: { 'l-q1': 'B' } } })
    });
    await handleApiRequest(syncReq, storage, mockEnv);
    const editReq = new Request('https://ieltsgate.test/api/exams/exam-ielts-academic-101/global-answer-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ questionId: 'l-q1', newAcceptedAnswers: ['B'] })
    });
    const editRes = await handleApiRequest(editReq, storage, mockEnv);
    const editData = await editRes.json();
    assert(
      editRes.status === 200 && editData.success === true &&
      typeof editData.affectedCandidatesCount === 'number' && editData.affectedCandidatesCount >= 1,
      'Global answer edit applies, recalculates cohort and reports affectedCandidatesCount'
    );
    const sessRes = await handleApiRequest(new Request('https://ieltsgate.test/api/sessions/IG-772104', { method: 'GET' }), storage, mockEnv);
    const sessData = await sessRes.json();
    assert(
      sessData.grading?.listeningScore !== undefined,
      'Regraded session persists the recalculated listening score'
    );
    const badReq = new Request('https://ieltsgate.test/api/exams/exam-ielts-academic-101/global-answer-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ questionId: 'no-such-q', newAcceptedAnswers: ['X'] })
    });
    const badRes = await handleApiRequest(badReq, storage, mockEnv);
    assert(badRes.status === 404, 'Global answer edit for unknown question returns 404 without changes');
  }

  // 19e. Entry gate: a session whose exam is no longer the active (posted)
  // exam is blocked; the active exam's own sessions may sync.
  {
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const setActive = await handleApiRequest(new Request('https://ieltsgate.test/api/admin/active-exam', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ activeExamId: 'exam-test-delete-me' })
    }), storage, mockEnv);
    assert(setActive.status === 200, 'Setup: active exam pointed elsewhere');
    const blockedSync = await handleApiRequest(new Request('https://ieltsgate.test/api/sessions/IG-772104/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSection: 'reading' })
    }), storage, mockEnv);
    const blockedData = await blockedSync.json();
    assert(blockedSync.status === 403 && blockedData.code === 'EXAM_NOT_OPEN', 'Sync for deactivated exam is rejected with 403 EXAM_NOT_OPEN');
    const restoreActive = await handleApiRequest(new Request('https://ieltsgate.test/api/admin/active-exam', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ activeExamId: 'none' })
    }), storage, mockEnv);
    assert(restoreActive.status === 200, 'Setup: active exam cleared');
    const allowedSync = await handleApiRequest(new Request('https://ieltsgate.test/api/sessions/IG-772104/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSection: 'reading' })
    }), storage, mockEnv);
    assert(allowedSync.status === 200, 'Sync for active/undated exam succeeds');
  }

  // 19e2. Entry gate: a session already IN the exam keeps saving while its
  // exam is deactivated (only unstarted sessions wait) — an admin date
  // change mid-session must not strand live candidates on transitions.
  {
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const mkSess = await handleApiRequest(new Request('https://ieltsgate.test/api/sessions', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ candidateName: 'In-Progress Probe', examId: 'exam-ielts-academic-101' })
    }), storage, mockEnv);
    assert(mkSess.status === 201, 'Setup: in-progress probe session created');
    const mkData = await mkSess.json();
    const probeCid = mkData.candidateId;
    const startSync = await handleApiRequest(new Request(`https://ieltsgate.test/api/sessions/${probeCid}/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' })
    }), storage, mockEnv);
    assert(startSync.status === 200, 'Setup: probe session started');
    await handleApiRequest(new Request('https://ieltsgate.test/api/admin/active-exam', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ activeExamId: 'exam-test-delete-me' })
    }), storage, mockEnv);
    const midExamSync = await handleApiRequest(new Request(`https://ieltsgate.test/api/sessions/${probeCid}/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSection: 'reading' })
    }), storage, mockEnv);
    assert(midExamSync.status === 200, 'In-progress session syncs while its exam is deactivated (no EXAM_NOT_OPEN)');
    const restoreActive2 = await handleApiRequest(new Request('https://ieltsgate.test/api/admin/active-exam', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ activeExamId: 'none' })
    }), storage, mockEnv);
    assert(restoreActive2.status === 200, 'Setup: active exam restored');
  }

  // 19e3. Re-submit is idempotent: an already-completed session that hits
  // Submit again (stale screen, double click) succeeds even when its exam
  // is deactivated — never EXAM_NOT_OPEN.
  {
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    await handleApiRequest(new Request('https://ieltsgate.test/api/admin/active-exam', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ activeExamId: 'exam-test-delete-me' })
    }), storage, mockEnv);
    const resubmit = await handleApiRequest(new Request('https://ieltsgate.test/api/sessions/IG-772104/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }), storage, mockEnv);
    const resubmitData = await resubmit.json();
    assert(resubmit.status === 200 && resubmitData.success === true, 'Completed session re-submits fine while exam deactivated');
    const restoreActive3 = await handleApiRequest(new Request('https://ieltsgate.test/api/admin/active-exam', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ activeExamId: 'none' })
    }), storage, mockEnv);
    assert(restoreActive3.status === 200, 'Setup: active exam restored again');
  }

  // 19f. Determined exam date gates entry even when settings say open.
  {
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const mkExam = await handleApiRequest(new Request('https://ieltsgate.test/api/exams', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ id: 'exam-test-dated', code: 'DT-1', title: 'Dated Exam', type: 'academic', examDate: `${yyyy}-${mm}-${dd}`, examTime: '09:00' })
    }), storage, mockEnv);
    assert(mkExam.status === 201, 'Setup: dated-future exam created');
    const mkSess = await handleApiRequest(new Request('https://ieltsgate.test/api/sessions', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ candidateName: 'Dated Probe', examId: 'exam-test-dated' })
    }), storage, mockEnv);
    const mkData = await mkSess.json();
    const datedCid = mkData.candidateId || mkData.id;
    const datedSync = await handleApiRequest(new Request(`https://ieltsgate.test/api/sessions/${datedCid}/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSection: 'reading' })
    }), storage, mockEnv);
    const datedData = await datedSync.json();
    assert(datedSync.status === 403 && datedData.code === 'EXAM_NOT_OPEN', 'Sync for future-dated exam is rejected despite settings open');
    await handleApiRequest(new Request('https://ieltsgate.test/api/exams/exam-test-dated', {
      method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` }
    }), storage, mockEnv);
  }

  // 19g. Import endpoints validate JSON sources before touching AI (offline-safe:
  // mock env has no import key, so validity checks must come first).
  {
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const toB64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');
    for (const route of ['reading-import-parse', 'listening-import-parse']) {
      const badJson = await handleApiRequest(new Request(`https://ieltsgate.test/api/admin/${route}`, {
        method: 'POST', headers: adminHeaders,
        body: JSON.stringify({ fileName: 'x.json', mimeType: 'application/json', fileBase64: toB64('{oops not json') })
      }), storage, mockEnv);
      assert(badJson.status === 400, `${route}: malformed JSON rejected with 400`);
      const txtFile = await handleApiRequest(new Request(`https://ieltsgate.test/api/admin/${route}`, {
        method: 'POST', headers: adminHeaders,
        body: JSON.stringify({ fileName: 'x.txt', mimeType: 'text/plain', fileBase64: toB64('hello') })
      }), storage, mockEnv);
      assert(txtFile.status === 400, `${route}: unsupported .txt rejected with 400`);
      const goodJson = await handleApiRequest(new Request(`https://ieltsgate.test/api/admin/${route}`, {
        method: 'POST', headers: adminHeaders,
        body: JSON.stringify({ fileName: 'x.json', mimeType: 'application/json', fileBase64: toB64('{"passages":[]}') })
      }), storage, mockEnv);
      assert(goodJson.status === 503, `${route}: valid JSON without import key yields friendly 503`);
    }
  }

  // 19h. Registration retention: submitted >7 days ago purged nightly, recent kept.
  {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    await storage.saveRegistration({
      id: 'REG-OLD001', candidateName: 'Old Timer', phone: '', email: '',
      examId: '', amountAzn: 45, status: 'pending', submittedAt: eightDaysAgo
    } as any);
    const result = await runRetentionCleanup(storage, mockEnv);
    assert(
      result.deletedRegistrationIds.includes('REG-OLD001'),
      'Nightly cleanup deletes registrations submitted over 7 days ago'
    );
    const kept = await storage.getRegistration(createdRegId);
    assert(kept !== undefined && kept.id === createdRegId, 'Recent registration survives the nightly cleanup');
    const gone = await storage.getRegistration('REG-OLD001');
    assert(gone === undefined, 'Purged registration is gone from the database');
    // Advance booking: submitted 8 days ago but the exam is tomorrow — must survive.
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const tIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await storage.saveRegistration({
      id: 'REG-FUTURE', candidateName: 'Early Bird', phone: '', email: '',
      examId: '', examDate: tIso, amountAzn: 45, status: 'pending', submittedAt: eightDaysAgo
    } as any);
    const result2 = await runRetentionCleanup(storage, mockEnv);
    const keptFuture = await storage.getRegistration('REG-FUTURE');
    assert(keptFuture !== undefined, 'Advance booking for a future exam survives despite old submission');
    void result2;
  }

  // 19h2. Speaking voice memos: speaking/ upload, private gate, 7-day purge.
  {
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const audioB64 = 'data:audio/webm;base64,' + Buffer.from('fake-voice-memo-bytes').toString('base64');
    const upReq = new Request('https://ieltsgate.test/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileData: audioB64, fileName: 'interview.webm', uploadType: 'speaking' })
    });
    const upRes = await handleApiRequest(upReq, storage, mockEnv);
    const upData = await upRes.json();
    assert(
      upRes.status === 201 &&
      typeof upData.key === 'string' && upData.key.startsWith('speaking/') &&
      typeof upData.url === 'string' && upData.url.startsWith('/api/files/speaking/'),
      'POST /api/upload stores speaking voice memo under speaking/ folder'
    );
    const memoUrl: string = upData.url;
    const memoKey: string = upData.key;

    const privRes = await handleApiRequest(new Request(`https://ieltsgate.test${memoUrl}`, { method: 'GET' }), storage, mockEnv);
    assert(privRes.status === 401, 'GET /api/files/speaking/... without admin token rejected with 401');

    const authRes = await handleApiRequest(
      new Request(`https://ieltsgate.test${memoUrl}`, { method: 'GET', headers: { Authorization: `Bearer ${adminToken}` } }),
      storage, mockEnv
    );
    assert(authRes.status === 200, 'GET /api/files/speaking/... WITH admin token allowed with 200');

    const gradeReq = new Request('https://ieltsgate.test/api/sessions/IG-772104/grade-speaking', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ overallBand: 7.0, audioUrl: memoUrl, audioRecordedAt: new Date().toISOString() })
    });
    const gradeRes = await handleApiRequest(gradeReq, storage, mockEnv);
    const gradeData = await gradeRes.json();
    assert(
      gradeRes.status === 200 &&
      gradeData.session?.grading?.speakingEvaluation?.audioUrl === memoUrl,
      'Grade-speaking links the voice memo to the session'
    );

    await runRetentionCleanup(storage, mockEnv);
    const sessFresh = await storage.getSession('IG-772104');
    assert(sessFresh?.grading?.speakingEvaluation?.audioUrl === memoUrl, 'Fresh speaking memo survives the nightly cleanup');
    const metaFresh = (await storage.listFileMetadata()).some(f => f.key === memoKey);
    assert(metaFresh, 'Fresh speaking file metadata survives the nightly cleanup');

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const curMeta = (await storage.listFileMetadata()).find(f => f.key === memoKey);
    await storage.saveFileMetadata({
      key: memoKey,
      fileName: curMeta?.fileName || 'interview.webm',
      fileType: 'audio/webm',
      fileSize: curMeta?.fileSize || 10,
      isPrivate: true,
      uploadedAt: eightDaysAgo
    });
    const sessOld = await storage.getSession('IG-772104');
    if (sessOld?.grading?.speakingEvaluation) {
      sessOld.grading.speakingEvaluation.audioRecordedAt = eightDaysAgo;
      await storage.saveSession(sessOld);
    }
    const cleanOld = await runRetentionCleanup(storage, mockEnv);
    assert(cleanOld.deletedFiles.includes(memoKey), 'Nightly cleanup deletes speaking memos recorded over 7 days ago');
    const sessKept = await storage.getSession('IG-772104');
    assert(sessKept !== undefined, 'Session survives after its speaking memo expires');
    assert(!sessKept?.grading?.speakingEvaluation?.audioUrl, 'Expired speaking memo is detached from the session');
  }

  // 19h3. Speaking part questions: examiner-typed free text saved with the grade.
  {
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const qReq = new Request('https://ieltsgate.test/api/sessions/IG-772104/grade-speaking', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        overallBand: 7.0,
        partQuestions: { part1: 'Where is your hometown?', part2: 'Describe a park.', part3: 'Cities vs countryside?' }
      })
    });
    const qRes = await handleApiRequest(qReq, storage, mockEnv);
    const qData = await qRes.json();
    assert(
      qRes.status === 200 &&
      qData.session?.grading?.speakingEvaluation?.partQuestions?.part1 === 'Where is your hometown?' &&
      qData.session?.grading?.speakingEvaluation?.partQuestions?.part3 === 'Cities vs countryside?',
      'Grade-speaking stores examiner-typed part questions'
    );
    // Re-grade without questions preserves them.
    const qReq2 = new Request('https://ieltsgate.test/api/sessions/IG-772104/grade-speaking', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ overallBand: 7.5 })
    });
    const qRes2 = await handleApiRequest(qReq2, storage, mockEnv);
    const qData2 = await qRes2.json();
    assert(
      qRes2.status === 200 &&
      qData2.session?.grading?.speakingEvaluation?.partQuestions?.part2 === 'Describe a park.',
      'Re-grading without part questions preserves the stored ones'
    );
  }

  // 19h4. Multiple-choice with 2+ answers: one mark per letter, one question
  // number per answer (e.g. one stem for Questions 11–12, two letters).
  {
    const legacy = { type: 'multiple_choice_multi', acceptedAnswers: ['B, D'] } as any;
    assert(JSON.stringify(getMultiLetters(legacy)) === JSON.stringify(['B', 'D']), 'Legacy combined key "B, D" migrates to per-letter rows');
    assert(JSON.stringify(getMultiLetters({ type: 'multiple_choice_multi', acceptedAnswers: ['D/E'] } as any)) === JSON.stringify(['D', 'E']), 'Slash-combined key "D/E" splits into per-letter rows');
    assert(JSON.stringify(getMultiLetters({ type: 'multiple_choice_multi', acceptedAnswers: ['b/c'] } as any)) === JSON.stringify(['B', 'C']), 'Lowercase slash key "b/c" normalizes to uppercase letters');
    assert(JSON.stringify(getMultiLetters({ type: 'multiple_choice_multi', acceptedAnswers: ['B D'] } as any)) === JSON.stringify(['B', 'D']), 'Space-separated single letters split');
    assert(JSON.stringify(getMultiLetters({ type: 'multiple_choice_multi', acceptedAnswers: ['B lapwing'] } as any)) === JSON.stringify(['B']), 'Full-text key keeps its leading letter only');
    const split = { type: 'multiple_choice_multi', acceptedAnswers: ['B', 'D'] } as any;
    assert(JSON.stringify(getMultiLetters(split)) === JSON.stringify(['B', 'D']), 'Already-split keys pass through unchanged');
    assert(questionSlots(split) === 2, 'A 2-letter multi consumes 2 question numbers');
    assert(questionSlots({ type: 'multiple_choice', acceptedAnswers: ['A'] } as any) === 1, 'A single-choice consumes 1 question number');
    assert(spanEndNumber({ number: 11, ...split } as any) === 12, 'Span of multi starting at 11 ends at 12');
    assert(scoreMultiMarks('B, C', split) === 1, 'Partial credit: 1 right + 1 wrong letter earns 1 mark');
    assert(scoreMultiMarks('B, D, E', split) === 2, 'Extra picks beyond the key are ignored (no penalty, no bonus)');
    assert(scoreMultiMarks('', split) === 0, 'Unanswered multi earns 0');
    assert(scoreQuestionMarks(split, 'B, D', true).earned === 2, 'Record override true grants full multi marks');
    assert(scoreQuestionMarks(split, 'B, D', false).earned === 0, 'Record override false grants zero');
    assert(
      JSON.stringify(expandNavSlots([{ id: 'm', number: 11, ...split } as any, { id: 's', number: 13, type: 'multiple_choice', acceptedAnswers: ['A'] } as any]).map(e => e.number)) === JSON.stringify([11, 12, 13]),
      'Navigation expands a 2-letter multi into dots 11 and 12'
    );
    const norm = normalizeMultiKeys({ type: 'multiple_choice_multi', acceptedAnswers: ['B, D'] } as any);
    assert(
      JSON.stringify(norm.acceptedAnswers) === JSON.stringify(['B', 'D']) && (norm as any).maxSelections === 2,
      'normalizeMultiKeys splits combined rows and defaults maxSelections'
    );

    // End-to-end scoring: multi (11–12) + single (13) = 3 marks total.
    const multiExam = {
      listening: { sections: [{ questions: [
        { id: 'm1', number: 11, type: 'multiple_choice_multi', prompt: 'Choose TWO letters.', options: ['A x', 'B y', 'C z', 'D w'], acceptedAnswers: ['B', 'D'], maxSelections: 2 },
        { id: 's1', number: 13, type: 'multiple_choice', prompt: 'Choose ONE letter.', options: ['A x', 'B y'], acceptedAnswers: ['A'] }
      ] }] },
      reading: { passages: [] }
    } as any;
    const fullSess = { listeningState: { answers: { m1: 'B, D', s1: 'A' } }, grading: {} } as any;
    const gFull = gradeListening(fullSess, multiExam);
    assert(gFull.total === 3 && gFull.raw === 3, 'Full marks: 2-letter multi + single total 3 marks, all correct = 3');
    const partSess = { listeningState: { answers: { m1: 'B, C', s1: 'A' } }, grading: {} } as any;
    const gPart = gradeListening(partSess, multiExam);
    assert(gPart.total === 3 && gPart.raw === 2, 'Partial: 1/2 multi letters + correct single = 2 of 3 marks');

    // Legacy combined key scores identically without re-saving.
    const legacyExam = {
      listening: { sections: [{ questions: [
        { id: 'm1', number: 11, type: 'multiple_choice_multi', prompt: 'Choose TWO letters.', options: ['A x', 'B y', 'C z', 'D w'], acceptedAnswers: ['B, D'], maxSelections: 2 }
      ] }] },
      reading: { passages: [] }
    } as any;
    const gLegacy = gradeListening({ listeningState: { answers: { m1: 'D, B' } }, grading: {} } as any, legacyExam);
    assert(gLegacy.total === 2 && gLegacy.raw === 2, 'Legacy combined key auto-migrates at score time (order-insensitive)');

    // Exam save persists the migration.
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const saveRes = await handleApiRequest(new Request('https://ieltsgate.test/api/exams', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        id: 'exam-test-multi-migrate', title: 'Multi Migrate Probe', type: 'academic',
        listening: { sections: [{ sectionNumber: 1, questions: [
          { id: 'mm1', number: 11, type: 'multiple_choice_multi', prompt: 'Choose TWO.', options: ['A x', 'B y'], acceptedAnswers: ['A, B'], maxSelections: 2 }
        ] }] },
        reading: { passages: [] }
      })
    }), storage, mockEnv);
    assert(saveRes.status === 201, 'Setup: probe exam with legacy multi key saved');
    const gotRes = await handleApiRequest(new Request('https://ieltsgate.test/api/exams/exam-test-multi-migrate', { method: 'GET' }), storage, mockEnv);
    const gotExam = await gotRes.json();
    assert(
      JSON.stringify(gotExam.listening.sections[0].questions[0].acceptedAnswers) === JSON.stringify(['A', 'B']),
      'Exam save splits legacy combined multi keys into one row per letter'
    );
    const delRes = await handleApiRequest(new Request('https://ieltsgate.test/api/exams/exam-test-multi-migrate', {
      method: 'DELETE', headers: adminHeaders
    }), storage, mockEnv);
    assert(delRes.status === 200, 'Cleanup: probe exam deleted');
  }

  // 19h5. Split multi records sharing one stem merge into a single range
  // record (e.g. two "Which TWO..." rows for Q15–16 become one record
  // holding ["A", "C"]), and renumbering consumes one number per letter.
  {
    const stem = 'Which TWO things are most popular among users?';
    const bank = ["A children's books", 'B textbooks', 'C computer games', 'D toys', 'E tools'];
    const splitPair = [
      { id: 'a', number: 15, type: 'multiple_choice_multi', prompt: stem, options: bank, acceptedAnswers: ['A'], maxSelections: 2 },
      { id: 'b', number: 16, type: 'multiple_choice_multi', prompt: stem, options: bank, acceptedAnswers: ['C'], maxSelections: 2 }
    ] as any;
    const merged = mergeConsecutiveMultis(splitPair) as any[];
    assert(merged.length === 1, 'Adjacent same-stem multi pair merges into one record');
    assert(JSON.stringify(merged[0].acceptedAnswers) === JSON.stringify(['A', 'C']), 'Merged record holds one row per letter');
    assert(merged[0].maxSelections === 2, 'Merged record keeps the shared Must Choose count');
    assert(merged[0].number === 15, 'Merged record keeps the first number (covers 15–16)');

    const lone = [{ id: 'c', number: 15, type: 'multiple_choice_multi', prompt: stem, options: bank, acceptedAnswers: ['A', 'C'], maxSelections: 2 }] as any;
    assert(mergeConsecutiveMultis(lone).length === 1, 'Already-merged multi passes through untouched');

    const otherBetween = [
      { id: 'a', number: 15, type: 'multiple_choice_multi', prompt: stem, options: bank, acceptedAnswers: ['A'], maxSelections: 2 },
      { id: 's', number: 16, type: 'short_answer', prompt: 'Other?', acceptedAnswers: ['x'] },
      { id: 'b', number: 17, type: 'multiple_choice_multi', prompt: stem, options: bank, acceptedAnswers: ['C'], maxSelections: 2 }
    ] as any;
    assert(mergeConsecutiveMultis(otherBetween).length === 3, 'Same-stem multis separated by another question do NOT merge');

    const diffBank = [
      { id: 'a', number: 15, type: 'multiple_choice_multi', prompt: stem, options: bank, acceptedAnswers: ['A'], maxSelections: 2 },
      { id: 'b', number: 16, type: 'multiple_choice_multi', prompt: stem, options: [...bank, 'F extra'], acceptedAnswers: ['C'], maxSelections: 2 }
    ] as any;
    assert(mergeConsecutiveMultis(diffBank).length === 2, 'Same stem with different option banks does NOT merge');

    const ren = renumberQuestionsWithSlots([
      { id: 'm', number: 1, type: 'multiple_choice_multi', prompt: stem, options: bank, acceptedAnswers: ['A', 'C'], maxSelections: 2 },
      { id: 's', number: 2, type: 'multiple_choice', prompt: 'Next?', options: ['A x', 'B y'], acceptedAnswers: ['A'] }
    ] as any) as any[];
    assert(ren[0].number === 1 && ren[1].number === 3, 'Renumber consumes two numbers for a 2-letter multi (next starts at 3, no overlap)');
  }

  // 19h6. Back-to-back tables survive insert consolidation with their own
  // layouts (regression: the pre-split version read the holder after
  // clearing the group, wiping every tableDef).
  {
    const island = [['', 'Type of room required:', 'double room'], ['', 'Stay: approx 2 weeks', ''], ['Temperature', 'Daytime: up to ___ °C', ''], ['', 'Normally takes about ___', ''], ['Facilities', 'a ___', ''], ['', 'three standard ___', '']];
    const ent = [['Tuesdays', 'make ___ / a ___', 'bus'], ['Wednesdays', 'garden ***', '*** shuttle'], ['Thursdays', 'display of ***', '***']];
    const qs = [
      { id: 'q1', number: 1, type: 'table_completion', prompt: '', acceptedAnswers: ['19'], tableDef: { title: 'NOTES', headers: ['A', 'B', 'C'], rows: island } },
      { id: 'q2', number: 2, type: 'table_completion', prompt: '', acceptedAnswers: ['40 minutes'] },
      { id: 'q3', number: 3, type: 'table_completion', prompt: '', acceptedAnswers: ['balcony'] },
      { id: 'q4', number: 4, type: 'table_completion', prompt: '', acceptedAnswers: ['tennis courts'] },
      { id: 'q5', number: 5, type: 'table_completion', prompt: '', acceptedAnswers: ['fish'], tableDef: { title: '', headers: ['D', 'E', 'F'], rows: ent } },
      { id: 'q6', number: 6, type: 'table_completion', prompt: '', acceptedAnswers: ['piano'] }
    ] as any;
    const out = consolidateTableGroups(qs) as any[];
    const gaps = (rows: string[][]) => rows.flat().join('|').split(/_{2,}|…|\*{3,}/).length - 1;
    assert(out[0].tableDef?.rows?.length === 6 && gaps(out[0].tableDef.rows) === 4, 'First table keeps its layout and 4 gaps');
    assert(out[4].tableDef?.rows?.length === 3 && gaps(out[4].tableDef.rows) === 6, 'Second back-to-back table keeps its layout and 6 gaps (*** counted)');
    assert(out[1].tableDef === undefined && out[5].tableDef === undefined, 'Sibling questions carry no duplicate layout');
  }

  // 19h8. Displayed totals count question numbers, not records: 38 records
  // with two 2-letter multis (Q15–16, Q39–40) cover Q1–40.
  {
    const qs = [] as any[];
    for (let i = 0; i < 14; i++) qs.push({ type: 'multiple_choice', acceptedAnswers: ['A'] });
    qs.push({ type: 'multiple_choice_multi', acceptedAnswers: ['A', 'C'] });
    for (let i = 0; i < 13; i++) qs.push({ type: 'sentence_completion', acceptedAnswers: ['x'] });
    for (let i = 0; i < 8; i++) qs.push({ type: 'table_completion', prompt: '', acceptedAnswers: ['y'] });
    qs.push({ type: 'multiple_choice_multi', acceptedAnswers: ['B', 'C'] });
    qs.push({ type: 'short_answer', acceptedAnswers: ['z'] });
    assert(qs.length === 38, 'Default-exam shape: 38 records');
    assert(countQuestionSlots(qs) === 40, 'Displayed total counts slots: 38 records cover 40 question numbers');
    assert(countQuestionSlots([]) === 0, 'Empty list counts zero');
  }

  // 19h7. Paragraph matching without a printed bank gets an explicit
  // letter range synthesized (answers + passage labels), so the dropdown
  // has options to choose from.
  {
    const passage = 'A Millions of years ago, drift split the worlds.\n\nB When Europeans first touched the shores, crops had not travelled.\n\nC Settlers cultivated wheat and apples.\n\nD Cattle arrived in Virginia.\n\nE Resistance was ineffective; germs decided.\n\nF Native animals did not revolutionise.\n\nG Crops explain the population explosion.\n\nH It has to do with environmental contrasts.';
    assert(JSON.stringify(parseParagraphLabels(passage)) === JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']), 'Bare paragraph labels A–H parse into a contiguous run');
    assert(JSON.stringify(parseParagraphLabels('A multitude of items are sold here.\n\nJust prose.')) === JSON.stringify(['A']), 'Stray prose A-start yields only a length-1 run (harmless floor)');
    assert(JSON.stringify(letterRangeBank('H')) === JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']), 'Letter range bank spans A–H');
    const qs = ['C', 'G', 'A', 'E', 'B', 'F', 'H', 'D'].map((a, i) => ({
      id: `m${i}`, number: 27 + i, type: 'matching_information',
      prompt: `Statement ${i}`, acceptedAnswers: [a], options: []
    })) as any[];
    const out = synthesizeParagraphBanks(qs, passage) as any[];
    assert(out.every(q => JSON.stringify(q.options) === JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])), 'Bank-less paragraph group gains the full A–H bank on every question');

    const noLabels = [{ id: 'x', number: 1, type: 'matching_information', prompt: 'S', acceptedAnswers: ['C'], options: [] }] as any[];
    synthesizeParagraphBanks(noLabels, 'Plain prose without labels.');
    assert(JSON.stringify((noLabels[0] as any).options) === JSON.stringify(['A', 'B', 'C']), 'Without passage labels the bank falls back to the answer-letter floor');

    const withBank = [{ id: 'y', number: 1, type: 'matching_information', prompt: 'S', acceptedAnswers: ['C'], options: ['A', 'B', 'C'] }] as any[];
    synthesizeParagraphBanks(withBank, passage);
    assert(JSON.stringify((withBank[0] as any).options) === JSON.stringify(['A', 'B', 'C']), 'Runs that already carry a bank are left untouched');

    const mixed = [
      { id: 's', number: 1, type: 'sentence_completion', prompt: 'Fill ___ here.', acceptedAnswers: ['x'], options: [] },
      { id: 'm', number: 2, type: 'matching_information', prompt: 'S', acceptedAnswers: ['B'], options: [] }
    ] as any[];
    synthesizeParagraphBanks(mixed, passage);
    assert((mixed[0] as any).options.length === 0 && JSON.stringify((mixed[1] as any).options) === JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']), 'Only matching_information runs gain banks; other types untouched');
  }

  // 19h. Session merge never drags a live candidate backward: furthest
  // section wins, while server lock/status/grading still apply.
  {
    const base = {
      candidateId: 'IG-TEST', candidateName: 'Merge Probe', examId: 'e1',
      examTitle: 'T', createdAt: '', status: 'in_progress', currentSection: 'writing',
      trfNumber: 'T', lastSavedAt: '',
      lockStatus: { violations: 0, isLocked: false, lockHistory: [] },
      listeningState: {}, readingState: {}, writingState: {}, grading: {}
    } as any;
    const stale = { ...base, currentSection: 'reading', candidateName: 'Stale' };
    const merged = mergeSessionPreferringProgress(base, stale) as any;
    assert(merged.currentSection === 'writing', 'Merge keeps the furthest section reached (no pushback)');
    assert(merged.candidateName === 'Merge Probe', 'Merge keeps local progress data');
    const ahead = { ...base, currentSection: 'review' };
    assert((mergeSessionPreferringProgress(base, ahead) as any).currentSection === 'review', 'Merge accepts forward movement');
    const locked = { ...stale, lockStatus: { violations: 2, isLocked: true, lockHistory: [] }, status: 'hard_locked' };
    const mergedLock = mergeSessionPreferringProgress(base, locked) as any;
    assert(mergedLock.currentSection === 'writing' && mergedLock.lockStatus.isLocked && mergedLock.status === 'hard_locked', 'Merge keeps section but applies proctor lock');
    assert(mergeSessionPreferringProgress(null, stale) === stale, 'Merge with no local state takes server state');
    assert(mergeSessionPreferringProgress(base, null) === base, 'Merge with no server state keeps local');
    assert(sectionRank('writing') > sectionRank('reading'), 'Section rank orders forward');
  }

  // 19i. Exam start is interpreted as Baku wall time (UTC+4), not server zone.
  {
    assert(EXAM_TIMEZONE_OFFSET_MS === 4 * 3600 * 1000, 'Exam timezone is Baku (UTC+4)');
    const ms = getExamStartMs({ examDate: '2026-09-13', examTime: '14:00' });
    assert(ms === Date.UTC(2026, 8, 13, 14, 0) - 4 * 3600 * 1000, '14:00 exam opens at 10:00 UTC (Baku wall time)');
    assert(getExamStartMs({ examDate: '2026-09-13' }) === Date.UTC(2026, 8, 13, 0, 0) - 4 * 3600 * 1000, 'Missing time defaults to Baku midnight');
    assert(getExamStartMs({}) === null && getExamStartMs(null) === null, 'Undated exams have no start (always open when active)');
    assert(getExamStartMs({ examDate: 'not-a-date', examTime: '14:00' }) === null, 'Malformed dates yield no start');
  }

  // 19j. Two-slot exam days: slots, shared cap, release gating.
  {
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const { getExamSlotStartMs, getExamResultsReleaseMs, isExamPaperReleased } = await import('./src/types');
    // Helpers: single-slot exams release immediately; two-slot release after slot 2 + duration.
    assert(isExamPaperReleased({ id: 'x', title: 'T', code: 'C', listening: { title: '', sections: [] }, reading: { title: '', durationMinutes: 60, passages: [] }, writing: { title: '', durationMinutes: 60, task1: {} as any, task2: {} as any } } as any), 'Single-slot exam paper is released immediately');
    const twoSlot = { examDate: '2026-09-13', examTime: '10:00', examTime2: '15:00' };
    assert(getExamSlotStartMs(twoSlot as any, 1) === Date.UTC(2026, 8, 13, 10, 0) - 4 * 3600 * 1000, 'Slot 1 starts at Baku wall time');
    assert(getExamSlotStartMs(twoSlot as any, 2) === Date.UTC(2026, 8, 13, 15, 0) - 4 * 3600 * 1000, 'Slot 2 starts at Baku wall time');
    assert(getExamSlotStartMs({ examDate: '2026-09-13' } as any, 2) === null, 'Missing second time means no slot 2');
    const rel = getExamResultsReleaseMs({ ...twoSlot, listening: { sections: [] }, reading: { durationMinutes: 60, passages: [] }, writing: { durationMinutes: 60, task1: {} as any, task2: {} as any } } as any);
    assert(typeof rel === 'number' && rel! > getExamSlotStartMs(twoSlot as any, 2)!, 'Two-slot release moment is after slot 2 start');
    assert(getExamResultsReleaseMs({ examDate: '2026-09-13', examTime: '10:00' } as any) === null, 'Single-slot exams have no release moment');
    assert(isExamPaperReleased({ ...twoSlot, resultsReleased: true } as any, 0) === true, 'Manual release flag always releases');
    assert(isExamPaperReleased({ ...twoSlot } as any, Date.UTC(2026, 8, 13, 6, 0)) === false, 'Paper withheld before release');
    assert(isExamPaperReleased({ ...twoSlot } as any, Date.UTC(2030, 0, 1)) === true, 'Paper visible after release passes');

    // Registration records the chosen slot (slot 2 stores slot time).
    const mkExam = await handleApiRequest(new Request('https://ieltsgate.test/api/exams', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ id: 'exam-test-twoslot', code: 'TS-1', title: 'Two-Slot Exam', type: 'academic', examDate: '2026-09-13', examTime: '10:00', examTime2: '15:00' })
    }), storage, mockEnv);
    assert(mkExam.status === 201, 'Setup: two-slot exam created');
    const mkReg = await handleApiRequest(new Request('https://ieltsgate.test/api/registrations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateName: 'Slot Two Candidate', m10ReceiptUrl: '/api/files/receipts/x.jpg', examId: 'exam-test-twoslot', examSlot: 2 })
    }), storage, mockEnv);
    const mkRegData = await mkReg.json();
    assert(mkReg.status === 201 && mkRegData.examSlot === 2 && mkRegData.examTime === '15:00', 'Registration stores slot 2 with slot time');
    const avail = await handleApiRequest(new Request('https://ieltsgate.test/api/registration-availability?examDate=2026-09-13', { method: 'GET' }), storage, mockEnv);
    const availData = await avail.json();
    assert(availData.bySlot && typeof availData.bySlot.slot2 === 'number', 'Availability reports per-slot counts');
    // Approval carries the slot onto the session.
    const approve = await handleApiRequest(new Request(`https://ieltsgate.test/api/registrations/${mkRegData.id}/approve`, {
      method: 'POST', headers: adminHeaders
    }), storage, mockEnv);
    const approveData = await approve.json();
    assert(approve.status === 200 && approveData.session && approveData.session.examSlot === 2, 'Approval copies slot onto the session');
    await handleApiRequest(new Request('https://ieltsgate.test/api/exams/exam-test-twoslot', {
      method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` }
    }), storage, mockEnv);
  }

  // 19k. Two-slot entry: slot-2 candidates wait for their own start time.
  {
    const { isCandidateEntryOpen } = await import('./src/server/apiHandler');
    const exam2slot = { examDate: '2026-09-13', examTime: '00:01', examTime2: '23:59' } as any;
    const openSettings = { activeExamId: null } as any;
    assert(isCandidateEntryOpen(openSettings, 'e1', exam2slot, 1) === true, 'Slot 1 may enter once slot 1 started');
    assert(isCandidateEntryOpen(openSettings, 'e1', exam2slot, undefined) === true, 'Unset slot follows slot 1');
    const examPast2 = { examDate: '2020-01-01', examTime: '00:01', examTime2: '00:02' } as any;
    assert(isCandidateEntryOpen(openSettings, 'e1', examPast2, 2) === true, 'Slot 2 may enter after its start passed');
    const examNoSlot2 = { examDate: '2026-09-13', examTime: '00:01' } as any;
    assert(isCandidateEntryOpen(openSettings, 'e1', examNoSlot2, 2) === true, 'Slot 2 without a second time follows slot 1');

    // API level: registered slot-2 session blocked before slot 2 starts.
    // Times are Baku wall clock derived from UTC instants, so the test is
    // correct in any machine timezone and never rots (all same-day).
    const nowMs = Date.now();
    const baku = new Date(nowMs + 4 * 3600 * 1000);
    const isoDay = `${baku.getUTCFullYear()}-${String(baku.getUTCMonth() + 1).padStart(2, '0')}-${String(baku.getUTCDate()).padStart(2, '0')}`;
    const mins = baku.getUTCHours() * 60 + baku.getUTCMinutes();
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const pastTime = fmt(Math.max(0, mins - 30));
    const futureTime = fmt(Math.min(24 * 60 - 1, mins + 120));
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    const mkExam = await handleApiRequest(new Request('https://ieltsgate.test/api/exams', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ id: 'exam-test-slotgate', code: 'SG-1', title: 'Slot Gate Exam', type: 'academic', examDate: isoDay, examTime: pastTime, examTime2: futureTime })
    }), storage, mockEnv);
    assert(mkExam.status === 201, 'Setup: slot-gate exam created');
    const mkS2 = await handleApiRequest(new Request('https://ieltsgate.test/api/sessions', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ candidateName: 'Slot Two Waiter', examId: 'exam-test-slotgate', examSlot: 2 })
    }), storage, mockEnv);
    const s2 = await mkS2.json();
    assert(mkS2.status === 201 && s2.examSlot === 2, 'Setup: slot-2 session created');
    const blockedS2 = await handleApiRequest(new Request(`https://ieltsgate.test/api/sessions/${s2.candidateId}/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSection: 'reading' })
    }), storage, mockEnv);
    const blockedS2Data = await blockedS2.json();
    assert(blockedS2.status === 403 && blockedS2Data.code === 'EXAM_NOT_OPEN', 'Registered slot-2 session blocked before slot 2 starts');
    const mkS1 = await handleApiRequest(new Request('https://ieltsgate.test/api/sessions', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ candidateName: 'Slot One Goer', examId: 'exam-test-slotgate', examSlot: 1 })
    }), storage, mockEnv);
    const s1 = await mkS1.json();
    const allowedS1 = await handleApiRequest(new Request(`https://ieltsgate.test/api/sessions/${s1.candidateId}/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSection: 'reading' })
    }), storage, mockEnv);
    assert(allowedS1.status === 200, 'Slot-1 session syncs while slot 2 is still pending');
    await handleApiRequest(new Request('https://ieltsgate.test/api/exams/exam-test-slotgate', {
      method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` }
    }), storage, mockEnv);
  }

  // 19l. Daily cap is shared: admin-added candidates occupy the 125/day pool.
  {
    const { getDateOccupancy } = await import('./src/server/apiHandler');
    const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
    // Isolated far-future dates so other fixtures can never collide.
    const capExam = await handleApiRequest(new Request('https://ieltsgate.test/api/exams', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ id: 'exam-test-cap', code: 'CAP-1', title: 'Cap Exam', type: 'academic', examDate: '2031-05-05', examTime: '10:00', examTime2: '15:00' })
    }), storage, mockEnv);
    assert(capExam.status === 201, 'Setup: cap exam created');
    // One approved-flow pair (registration + its session must count ONCE).
    await storage.saveRegistration({ id: 'REG-CAP1', candidateName: 'Cap Reg', phone: '', email: '', examId: 'exam-test-cap', examDate: '2031-05-05', examSlot: 2, amountAzn: 45, status: 'approved', submittedAt: new Date().toISOString() } as any);
    await storage.saveSession({ candidateId: 'IG-CAP1', candidateName: 'Cap Reg', examId: 'exam-test-cap', examSlot: 2, registrationId: 'REG-CAP1', status: 'registered', currentSection: 'listening', createdAt: new Date().toISOString(), lockStatus: { violations: 0, isLocked: false, lockHistory: [] }, listeningState: {}, readingState: {}, writingState: {}, grading: {}, trfNumber: 'T', lastSavedAt: new Date().toISOString() } as any);
    // One rejected registration (frees its slot) + two admin-added sessions.
    await storage.saveRegistration({ id: 'REG-CAP2', candidateName: 'Cap Rej', phone: '', email: '', examId: 'exam-test-cap', examDate: '2031-05-05', amountAzn: 45, status: 'rejected', submittedAt: new Date().toISOString() } as any);
    await storage.saveSession({ candidateId: 'IG-CAP2', candidateName: 'Cap Admin 1', examId: 'exam-test-cap', examSlot: 1, status: 'registered', currentSection: 'listening', createdAt: new Date().toISOString(), lockStatus: { violations: 0, isLocked: false, lockHistory: [] }, listeningState: {}, readingState: {}, writingState: {}, grading: {}, trfNumber: 'T', lastSavedAt: new Date().toISOString() } as any);
    await storage.saveSession({ candidateId: 'IG-CAP3', candidateName: 'Cap Admin 2', examId: 'exam-test-cap', status: 'registered', currentSection: 'listening', createdAt: new Date().toISOString(), lockStatus: { violations: 0, isLocked: false, lockHistory: [] }, listeningState: {}, readingState: {}, writingState: {}, grading: {}, trfNumber: 'T', lastSavedAt: new Date().toISOString() } as any);
    const usage = await getDateOccupancy(storage, '2031-05-05');
    assert(usage.registrations === 1 && usage.adminSessions === 2 && usage.taken === 3, 'Occupancy counts regs once + admin sessions, skips rejected');
    assert(usage.bySlot.slot2 === 1 && usage.bySlot.slot1 === 2, 'Per-slot split counts both channels');

    // Fill a second date to the cap purely with admin sessions, then both
    // creation channels must refuse with 400.
    const fullExam = await handleApiRequest(new Request('https://ieltsgate.test/api/exams', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ id: 'exam-test-full', code: 'FULL-1', title: 'Full Exam', type: 'academic', examDate: '2031-06-06', examTime: '10:00' })
    }), storage, mockEnv);
    assert(fullExam.status === 201, 'Setup: full exam created');
    for (let i = 0; i < 125; i++) {
      await storage.saveSession({ candidateId: `IG-FULL${i}`, candidateName: `Full ${i}`, examId: 'exam-test-full', status: 'registered', currentSection: 'listening', createdAt: new Date().toISOString(), lockStatus: { violations: 0, isLocked: false, lockHistory: [] }, listeningState: {}, readingState: {}, writingState: {}, grading: {}, trfNumber: 'T', lastSavedAt: new Date().toISOString() } as any);
    }
    const blockedAdmin = await handleApiRequest(new Request('https://ieltsgate.test/api/sessions', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ candidateName: 'One Too Many', examId: 'exam-test-full' })
    }), storage, mockEnv);
    assert(blockedAdmin.status === 400, 'Admin session creation blocked when the day is full');
    const blockedReg = await handleApiRequest(new Request('https://ieltsgate.test/api/registrations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateName: 'One Too Many', m10ReceiptUrl: '/api/files/receipts/x.jpg', examId: 'exam-test-full' })
    }), storage, mockEnv);
    assert(blockedReg.status === 400, 'Public registration blocked when the day is full of admin sessions');
    const fullAvail = await handleApiRequest(new Request('https://ieltsgate.test/api/registration-availability?examDate=2031-06-06', { method: 'GET' }), storage, mockEnv);
    const fullAvailData = await fullAvail.json();
    assert(fullAvailData.isFull === true && fullAvailData.registered >= 125, 'Availability reports the day full');
    await handleApiRequest(new Request('https://ieltsgate.test/api/exams/exam-test-cap', {
      method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` }
    }), storage, mockEnv);
    await handleApiRequest(new Request('https://ieltsgate.test/api/exams/exam-test-full', {
      method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` }
    }), storage, mockEnv);
  }

  // 19m. Multi-chart Task 1 JSON: arrays validate per item, singles stay objects.
  {
    const { parseTask1ChartData } = await import('./src/components/Task1Chart');
    const two = parseTask1ChartData(JSON.stringify([
      { chartType: 'pie_chart', title: 'Male', labels: ['A', 'B'], values: [60, 40] },
      { chartType: 'pie_chart', title: 'Female', labels: ['A', 'B'], values: [30, 70] }
    ]), 'pie_chart');
    assert(!two.error && Array.isArray(two.data) && two.data.length === 2, 'Two pie charts parse as an array');
    const mixed = parseTask1ChartData(JSON.stringify([
      { labels: ['X', 'Y'], series: [{ name: 'S', values: [1, 2] }] },
      { chartType: 'process_diagram', stages: ['A', 'B'] }
    ]), 'bar_chart');
    assert(!mixed.error && Array.isArray(mixed.data) && mixed.data.length === 2, 'Mixed charts parse, missing type falls back');
    const bad = parseTask1ChartData(JSON.stringify([
      { chartType: 'pie_chart', labels: ['A'], values: [1] },
      { chartType: 'pie_chart', labels: ['A', 'B'], values: [1] }
    ]), 'pie_chart');
    assert(!!bad.error && bad.error.startsWith('Chart 2:'), 'Bad second chart reports an indexed error');
    const single = parseTask1ChartData('{"labels":["A"],"values":[1]}', 'pie_chart');
    assert(!single.error && !Array.isArray(single.data), 'Single chart still returns a plain object');
    const empty = parseTask1ChartData('[]', 'bar_chart');
    assert(!!empty.error, 'Empty chart array is rejected');
  }

  // 20. Admin Logout
  {
    const req = new Request('https://ieltsgate.test/api/admin/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const res = await handleApiRequest(req, storage, mockEnv);
    assert(res.status === 200, 'POST /api/admin/logout successfully revokes session');

    // Verify token is now rejected
    const reqVerify = new Request('https://ieltsgate.test/api/admin/verify', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const resVerify = await handleApiRequest(reqVerify, storage, mockEnv);
    assert(resVerify.status === 401, 'Logged-out admin token is immediately rejected with 401');
  }

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error('Fatal test runner error:', e);
  process.exit(1);
});
