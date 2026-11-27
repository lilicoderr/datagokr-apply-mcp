// 가짜 data.go.kr (테스트 전용). 실제 포털이 아니다: src/apply.js 의 선택자/URL 가정을 흉내낸 것뿐이라
// 여기서 통과해도 실제 포털에서 동작한다는 증거는 아니다. 실제 키/쿠키는 없고 전부 가짜 값이다.
import http from 'node:http';

export const FAKE_COOKIE = 'FAKESESSION';
export const FAKE_DEC = 'FAKEFAKEFAKEfakeKEY+EXAMPLE/NOTAREALKEY0123456789abcdefghij==';
export const FAKE_ENC = encodeURIComponent(FAKE_DEC);
export const FAKE_HEX = 'fa4e0000'.repeat(8); // 64자 가짜 hex 키

const html = (body) => `<!doctype html><meta charset="utf-8"><title>FAKE portal</title><body>${body}</body>`;
const alertThen = (msg, to) => html(`<script>setTimeout(() => { alert(${JSON.stringify(msg)}); location.replace(${JSON.stringify(to)}); }, 50)</script>`);
const NAV = '<nav><a href="#">서비스 소개 안내</a><a href="#">개인정보처리방침</a><a href="#">이용 정보 안내</a></nav>';
const LIST = '/iim/api/selectAcountList.do';
const LOGIN = '/uim/login/loginView.do';

// pk 별 시나리오
export const SCENARIO = {
  success: '9001', alreadyOnLoad: '9002', alreadyOnSubmit: '9003', noAgreement: '9004', otherAgreement: '9005',
  buttonMissing: '9006', linkType: '9007', shortPurpose: '9008', notCompleted: '9009', preChecked: '9010',
  slow: '9011', confirmSaysDone: '9012', expireOnSubmit: '9013',
};
const nameOf = (pk) => Object.keys(SCENARIO).find((k) => SCENARIO[k] === pk);

function formPage(pk) {
  const s = nameOf(pk);
  const agreement = s === 'noAgreement' ? '' : `
    <input type="checkbox" id="agree" name="agree" style="display:none" ${s === 'preChecked' ? 'checked' : ''}>
    <label for="agree">${s === 'otherAgreement' ? '위 내용을 확인함' : '동의합니다'}</label>`;
  const confirmText = s === 'confirmSaysDone' ? '신청 완료 후에는 수정할 수 없습니다. 신청하시겠습니까?' : '활용신청 하시겠습니까?';
  const button = s === 'buttonMissing' ? '' : '<button type="button" onclick="send()">활용신청하기</button>';
  return html(`${NAV}<form id="f" method="post" action="/tcs/dss/insertDevAcountRequest.do?publicDataPk=${pk}">
    <textarea name="prcusePurps"></textarea>${agreement}${button}</form>
    <script>function send() { if (confirm(${JSON.stringify(confirmText)})) document.getElementById('f').submit(); }</script>`);
}

export const KEY_PAGE = {
  inputs: `<h3>일반 인증키</h3><table><tr><th>일반 인증키(Encoding)</th><td><input type="hidden" name="_csrf" value="FAKE-CSRF"><input readonly value="${FAKE_ENC}"></td></tr>
    <tr><th>일반 인증키(Decoding)</th><td><input readonly value="${FAKE_DEC}"></td></tr></table>`,
  headerRow: `<table><tr><th>일반 인증키(Encoding)</th><th>일반 인증키(Decoding)</th></tr><tr><td>${FAKE_ENC}</td><td>${FAKE_DEC}</td></tr></table>`,
  entities: `<h3>일반 인증키</h3>Encoding <input value="${FAKE_ENC}"> Decoding <input value="${FAKE_DEC.replace(/\+/g, '&#43;').replace(/=/g, '&#x3D;')}">`,
  farLabel: `<a>일반 인증키 안내</a><p>${'안내 문구입니다. '.repeat(300)}</p><h3>일반 인증키</h3><p>Encoding</p><code>${FAKE_ENC}</code><p>Decoding</p><code>${FAKE_DEC}</code>`,
  hex: `<h3>일반 인증키</h3><p>Encoding <textarea readonly>${FAKE_HEX}</textarea></p><p>Decoding <textarea readonly>${FAKE_HEX}</textarea></p>`,
  truncated: `<h3>일반 인증키</h3><p>Encoding ${FAKE_ENC.slice(0, 30)}...</p>`,
  none: '<p>활용신청 현황 0</p>',
};

/**
 * state 를 바꿔 가며 시나리오를 고른다.
 *   expired: null | 'redirect'(302 → 로그인) | 'alert'(200 + 알림창 → 첫 화면)
 */
export async function startFakePortal() {
  const state = { expired: null, keyPage: 'inputs', listKeyPage: 'none', submissions: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (body, status = 200) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };
    const redirect = (to) => { res.writeHead(302, { location: to }); res.end(); };
    const p = url.pathname;
    const pk = url.searchParams.get('publicDataPk');
    if (p === '/') return send(html('FAKE main'));
    if (p === LOGIN) return send(html('<h1>FAKE 로그인 화면</h1>'));
    const authed = String(req.headers.cookie || '').includes(`${FAKE_COOKIE}=ok`);
    if (!authed || state.expired === 'redirect') return redirect(LOGIN);
    if (state.expired === 'alert') return send(alertThen('세션이 만료되었습니다. 로그인이 필요합니다.', '/'));

    if (p === '/iim/main/mypageMain.do') return send(html('마이페이지'));
    if (p === '/tcs/dss/redirectDevAcountRequestForm.do') return redirect(`/tcs/dss/selectDevAcountRequestForm.do?publicDataPk=${pk}`);
    if (p === '/tcs/dss/selectDevAcountRequestForm.do') {
      if (nameOf(pk) === 'alreadyOnLoad') return send(alertThen('이미 활용신청한 내역이 있습니다.', LIST));
      if (nameOf(pk) === 'linkType') return send(html('<p>LINK 유형: 제공기관 사이트에서 신청하세요.</p>'));
      return send(formPage(pk));
    }
    if (p === '/tcs/dss/insertDevAcountRequest.do' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const s = nameOf(pk);
        const purpose = form.get('prcusePurps') || '';
        const back = `/tcs/dss/selectDevAcountRequestForm.do?publicDataPk=${pk}`;
        if (s === 'expireOnSubmit') return redirect(LOGIN);
        if (s === 'alreadyOnSubmit') return send(alertThen('이미 신청한 API 입니다.', LIST));
        if (s !== 'noAgreement' && form.get('agree') !== 'on') return send(alertThen('이용허락범위에 동의해 주세요.', back));
        if (purpose.length < 5 || s === 'shortPurpose') return send(alertThen('활용목적을 5자 이상 입력해 주세요.', back));
        if (s === 'notCompleted' || s === 'confirmSaysDone') return send(alertThen('오류로 신청이 완료되지 않았습니다.', back));
        state.submissions.push({ pk, purpose, agree: form.get('agree') });
        const ok = () => send(alertThen('활용신청이 완료되었습니다.', LIST));
        return s === 'slow' ? setTimeout(ok, 6000) : ok();
      });
      return;
    }
    if (p === LIST) {
      return send(html(`${NAV}<h2>활용신청 현황 2</h2><table><tr><td><a>[승인] 가짜기관_가짜 조회서비스</a></td></tr>
        <tr><td><a>[신청] 가짜기관_다른 정보</a></td></tr></table>${KEY_PAGE[state.listKeyPage]}`));
    }
    if (p === '/iim/api/selectAPIAcountView.do') {
      return state.keyPage === '404' ? send(html('404'), 404) : send(html(NAV + KEY_PAGE[state.keyPage]));
    }
    return send(html('404'), 404);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}
