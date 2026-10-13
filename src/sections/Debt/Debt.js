import './Debt.scss';
import PrivatLogo from '../../assets/images/icons/ic_privat24.svg'
import MtbLogo from '../../assets/images/icons/ic_mtb.svg'
import html2pdf from 'html2pdf.js';

// Smooth scroll function with easing
// номер поточної анімації — щоб її можна було зупинити (cancelSmoothScroll)
let smoothScrollFrame = 0;
const cancelSmoothScroll = () => {
    cancelAnimationFrame(smoothScrollFrame);
    smoothScrollFrame = 0;
};

const smoothScrollTo = (targetElement) => {
    if (!targetElement) return;
    cancelSmoothScroll();

    const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - 80; // 80px offset від верху
    const startPosition = window.pageYOffset;
    const distance = targetPosition - startPosition;
    const duration = 1000; // 1 second for smooth animation
    let startTime = null;

    // Easing function for smooth animation
    const easeInOutCubic = (t) => {
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    const animation = (currentTime) => {
        if (startTime === null) startTime = currentTime;
        const timeElapsed = currentTime - startTime;
        const progress = Math.min(timeElapsed / duration, 1);
        const ease = easeInOutCubic(progress);

        window.scrollTo(0, startPosition + distance * ease);

        if (progress < 1) {
            smoothScrollFrame = requestAnimationFrame(animation);
        }
    };

    smoothScrollFrame = requestAnimationFrame(animation);
};

const statuses = {
    Idle: "IDLE",
    Pending: "PENDING",
    Success: "SUCESS",
    Error: "ERROR"
}
let sendData = {
    value: "",
    ident: "",
    confirm: false,
}
const state = {
    status: statuses.Idle,
    error: "",
    data: [],
    disabled: false,
}

const privatUrls = new Map()
let activeMtbController = null

// ============================================================
// MOCK MODE — заглушка з тестовими даними замість живого бекенду.
// Вмикається автоматично в dev-сервері (npm start), у збірці (npm run build) — живий бекенд.
// Щоб у dev-сервері ходити на справжній бекенд — поставте тут false.
// ============================================================
const USE_MOCK = process.env.NODE_ENV !== 'production'

const MOCK = {
    // Сценарій 1: прямий збіг — одразу показує борг
    directName: 'Кравецький Володимир Іванович',
    directBirthDateISO: '1985-06-15',

    // Сценарій 2: омонім — спочатку просить дату народження
    conflictName: 'Іваненко Іван Іванович',
    conflictBirthDate: '01.01.2000',   // user input format DD.MM.YYYY
    conflictBirthDateISO: '2000-01-01',

    // Сценарій 3: платники з макетів — ідентифікатор = останні цифри податкового номера
    payers: {
        // борг лише за землю (як на макеті)
        'тирко надія михайлівна': { identification: '708', date: '2026-01-01', debts: { land_debt: 529.32, non_residential_debt: 0, orenda_debt: 0, mpz: 0 } },
        // знайдена, але боргів немає — усі кнопки «Сплатити» неактивні
        'шевчук олена петрівна': { identification: '052', date: '2026-01-01', debts: { land_debt: 0, non_residential_debt: 0, orenda_debt: 0, mpz: 0 } },
    },

    latencyMs: 400, // імітація мережі
}

const buildMockDebt = (name, birthDateISO, identification, date, debts = {}) => ({
    data: {
        id: 'MOCK-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
        date,
        name,
        birth_date: birthDateISO,
        identification,
        non_residential_debt: 1250.50,
        residential_debt: 0,
        land_debt: 875.30,
        orenda_debt: 412.00,
        mpz: 320.75,
        urlNonresident: 'https://next.privat24.ua/payments/form/{"token":"mock_nr"}',
        urlResident: null,
        urlLand: 'https://next.privat24.ua/payments/form/{"token":"mock_land"}',
        urlOrenda: 'https://next.privat24.ua/payments/form/{"token":"mock_orenda"}',
        urlMPZ: 'https://next.privat24.ua/payments/form/{"token":"mock_mpz"}',
        requisite_non_residential_debt: 'IBAN: UA908999980000000000123456789\nЄДРПОУ: 37874947\nПризначення: Податок на нерухоме майно (нежитлова)',
        requisite_residential_debt: null,
        requisite_land_debt: 'IBAN: UA908999980000000000234567890\nЄДРПОУ: 37874947\nПризначення: Земельний податок з фізичних осіб',
        requisite_orenda_debt: 'IBAN: UA908999980000000000345678901\nЄДРПОУ: 37874947\nПризначення: Орендна плата за землю',
        requisite_mpz: 'IBAN: UA908999980000000000456789012\nЄДРПОУ: 37874947\nПризначення: Мінімальне податкове зобов\'язання',
        ...debts,
    },
})

const normalizePib = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase()

// ПІБ для показу й документів: усі літери великі, зайві пробіли прибрано.
// «  тирко НАДІЯ михайлівна» → «ТИРКО НАДІЯ МИХАЙЛІВНА»
const formatPersonName = (s) => (s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('uk')

// Дата народження: ввід ДД.ММ.РРРР (або Д.М.РРРР, через . / -) -> ISO yyyy-mm-dd,
// бо бекенд зберігає/звіряє identification у форматі yyyy-mm-dd. Якщо вже ISO/не дата — як є.
const toISODate = (s) => {
    const t = (s || '').trim()
    const dmy = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/.exec(t)
    if (dmy) {
        const [, d, m, y] = dmy
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }
    return t
}

const mockResponse = (body, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
})

// Тестові договори для комунальних послуг (формат як у POST /check-utility-debt)
const MOCK_UTILITIES = {
    '123456': [
        { payerident: '123456', adress: 'м. Шептицький, просп. Шевченка, 19, кв. 7', paymentPurpose: 'Водопостачання та водовідведення', charge: 845.6 },
        { payerident: '123456', adress: 'м. Шептицький, просп. Шевченка, 19, кв. 7', paymentPurpose: 'Вивезення побутових відходів', charge: 0 },
        { payerident: '123456', adress: 'м. Шептицький, просп. Шевченка, 19, кв. 7', paymentPurpose: 'Утримання будинку та прибудинкової території', charge: 312.15 },
    ],
    // договір без боргу
    '777777': [
        { payerident: '777777', adress: 'м. Шептицький, вул. Івана Франка, 3, кв. 12', paymentPurpose: 'Водопостачання та водовідведення', charge: 0 },
    ],
}

const mockUtilitiesFetch = async (contractNumber) => {
    await new Promise((r) => setTimeout(r, MOCK.latencyMs))
    const items = MOCK_UTILITIES[contractNumber.replace(/\s+/g, '')]
    return items
        ? mockResponse({ data: items })
        : mockResponse({ message: 'За вказаним номером договору нічого не знайдено.' }, 404)
}

const mockFetch = async (inputData, url) => {
    await new Promise((r) => setTimeout(r, MOCK.latencyMs))

    const username = normalizePib(inputData.username)
    const ident = (inputData.ident || '').trim()
    const today = new Date().toISOString().slice(0, 10)

    if (url === '/info' && username === normalizePib(MOCK.directName)) {
        return mockResponse(buildMockDebt(MOCK.directName, MOCK.directBirthDateISO, '1234', today))
    }

    const payer = MOCK.payers[username]
    if (url === '/info' && payer) {
        return mockResponse(buildMockDebt(inputData.username.trim(), null, payer.identification, payer.date, payer.debts))
    }

    if (url === '/info' && username === normalizePib(MOCK.conflictName)) {
        return mockResponse(
            { data: 'Знайдено кілька осіб з таким ПІБ. Введіть дату народження у форматі ДД.ММ.РРРР для уточнення.' },
            300
        )
    }

    if (url === '/confirm' && username === normalizePib(MOCK.conflictName)) {
        // ident вже нормалізовано у ISO (yyyy-mm-dd) перед відправкою
        if (ident === MOCK.conflictBirthDateISO) {
            return mockResponse(buildMockDebt(MOCK.conflictName, MOCK.conflictBirthDateISO, '5678', today))
        }
        return mockResponse({ data: 'Дата народження не співпадає. Перевірте і спробуйте ще раз.' })
    }

    return mockResponse({ data: 'За вашим запитом нічого не знайдено.' })
}

const formatLocale = (number) => {
    return `${new Intl.NumberFormat('ua-UK', { style: 'currency', currency: 'UAH' }).format(number)}.`
}

const formatDateUA = new Intl.DateTimeFormat('uk-UA', { year: "numeric", month: "2-digit", day: "2-digit" });
const inputText = document.querySelector(".debt__input")
const btnSubmit = document.querySelector('.debt__submit')
const submitForm = document.querySelector('.debt__form')

const fetchData = async (inputData, url) => {
    try {
        state.status = statuses.Pending
        state.error = ""
        state.data = []
        state.disabled = true
        inputText.disabled = true
        btnSubmit.disabled = true
        updateUI()

        const info = USE_MOCK
            ? await mockFetch(inputData, url)
            : await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(inputData)
            })

        if (info?.status === 300) {
            sendData.confirm = true
            // Другий крок уточнення — завжди дата народження (міграція з 3 цифр ІПН на ДН).
            inputText.placeholder = "Дата народження (ДД.ММ.РРРР)"
        }

        if (sendData.ident && sendData.confirm) {
            sendData.confirm = false
            sendData.ident = ""
            sendData.value = ""
            inputText.placeholder = "Прізвище ім’я по-батькові"
        }

        const data = await info.json()
        // як би людина не ввела ПІБ, у картці, реквізитах і PDF воно буде великими літерами
        if (data?.data?.name && typeof data.data.name === 'string') {
            data.data.name = formatPersonName(data.data.name)
        }
        state.status = statuses.Success
        state.data = data
        updateUI()
    } catch (error) {
        // технічну помилку (мережа, не-JSON відповідь тощо) — в консоль, людині — зрозумілий текст
        console.error('Debt request failed:', error)
        state.status = statuses.Error
        state.error = 'Не вдалося отримати дані. Спробуйте, будь ласка, пізніше.'
        updateUI()
    }
    finally {
        // ПІБ лишаємо в полі (як на макеті); очищаємо лише для кроку з датою народження і після нього
        if (sendData.confirm || url === '/confirm') inputText.value = ""
        inputText.disabled = false
        updateSubmitState()
    }
}

// ============================================================
// АДМІНІСТРАТИВНІ ПОСЛУГИ: пошук рахунку за 6-значним номером квитанції й оплата онлайн.
// POST /api/searchAccount { identifier } → дані рахунку (платник, сума, призначення, реквізити)
// POST /api/payOnline     { identifier } → { url } — посилання на оплату
// TODO(бекенд): звірити назви полів відповіді з API (див. normalizeAdminAccount).
// ============================================================
const ADMIN_SEARCH_URL = '/api/searchAccount'
const ADMIN_PAY_URL = '/api/payOnline'

const MOCK_ADMIN = {
    '608936': {
        success: true,
        account_number: '608936',
        payer: 'Дудяк Василь Романович',
        amount: 151.4,
        name: 'ЗТГ/22012500; За надання інших адміністративних послуг (інформації з ДЗК)',
        edrpou: '38008294',
        mfo: '305299',
        iban: 'UA348999980334179879027013945',
    },
}

const mockAdminFetch = async (url, identifier) => {
    await new Promise((r) => setTimeout(r, MOCK.latencyMs))
    const account = MOCK_ADMIN[identifier]
    if (url === ADMIN_PAY_URL) return mockResponse(account ? { url: null, mock: true } : { message: 'Рахунок не знайдено' }, account ? 200 : 404)
    return account
        ? mockResponse(account)
        : mockResponse({ success: false, message: 'За вказаними даними інформацію не знайдено.' }, 404)
}

// Приводимо відповідь до одного вигляду: бекенд може віддати поля під різними назвами
const pick = (obj, keys) => keys.map((key) => obj?.[key]).find((value) => value !== undefined && value !== null && value !== '')
const normalizeAdminAccount = (body, identifier) => {
    const raw = body?.data && typeof body.data === 'object' ? body.data : body
    if (!raw || typeof raw !== 'object' || raw.success === false) return null
    return {
        number: pick(raw, ['account_number', 'accountNumber', 'identifier', 'number']) ?? identifier,
        payer: pick(raw, ['payer', 'payerName', 'fullName', 'name_payer']),
        amount: Number(pick(raw, ['amount', 'sum', 'charge'])) || 0,
        purpose: pick(raw, ['name', 'purpose', 'paymentPurpose', 'serviceName']),
        edrpou: pick(raw, ['edrpou', 'EDRPOU', 'code']),
        mfo: pick(raw, ['mfo', 'MFO']),
        iban: pick(raw, ['iban', 'IBAN', 'account']),
        payUrl: pick(raw, ['url', 'payUrl', 'paymentUrl']),
    }
}

const fetchAdminService = async (identifier) => {
    state.status = statuses.Pending
    state.error = ""
    state.data = []
    inputText.disabled = true
    btnSubmit.disabled = true
    updateUI()

    try {
        const res = USE_MOCK
            ? await mockAdminFetch(ADMIN_SEARCH_URL, identifier)
            : await fetch(ADMIN_SEARCH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier }),
            })
        const body = await res.json()
        const account = res.ok ? normalizeAdminAccount(body, identifier) : null
        if (!account) {
            state.status = statuses.Error
            state.error = withNotFoundHint(
                body?.message || body?.error || (typeof body?.data === 'string' && body.data) || 'нічого не знайдено',
                'admin'
            )
        } else {
            state.status = statuses.Success
            state.data = { admin: account, identifier }
        }
    } catch (error) {
        console.error('Admin service request failed:', error)
        state.status = statuses.Error
        state.error = 'Не вдалося отримати дані. Спробуйте, будь ласка, пізніше.'
    } finally {
        inputText.disabled = false
        updateUI()
        updateSubmitState()
    }
}

// Пошук комунальної заборгованості за номером договору: POST /check-utility-debt
// Відповідь: { data: [{ payerident, contractNumber, adress, paymentPurpose, charge }] } або масив;
// помилка — не-2xx з { message }
const fetchUtilities = async (contractNumber) => {
    state.status = statuses.Pending
    state.error = ""
    state.data = []
    inputText.disabled = true
    btnSubmit.disabled = true
    updateUI()

    try {
        const res = USE_MOCK
            ? await mockUtilitiesFetch(contractNumber)
            : await fetch('/check-utility-debt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contractNumber }),
            })
        const body = await res.json()
        const items = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : null)

        if (!res.ok || !items || !items.length) {
            state.status = statuses.Error
            state.error = withNotFoundHint(
                body?.message
                    || (typeof body?.data === 'string' && body.data)
                    || 'За вказаним номером договору нічого не знайдено.',
                'utilities'
            )
        } else {
            state.status = statuses.Success
            state.data = { utilities: items, contractNumber }
        }
    } catch (error) {
        console.error('Utilities request failed:', error)
        state.status = statuses.Error
        state.error = 'Не вдалося отримати дані. Спробуйте, будь ласка, пізніше.'
    } finally {
        inputText.disabled = false
        updateUI()
        updateSubmitState()
    }
}

function createElement(tag, classname, content) {
    const element = document.createElement(tag)
    element.className = classname
    element.textContent = content
    return element
}

// на випадок різних посилань для різних податків
function createElementWithAttributes(tag, classname, content, attributes = {}) { 
    const element = document.createElement(tag)
    element.className = classname
    if (content) element.textContent = content
    
    // Додаємо атрибути
    Object.keys(attributes).forEach(key => {
        element.setAttribute(key, attributes[key])
    })
    
    return element
}

// на випадок різних посилань для різних податків
function createFlexContainer(leftContent, rightContent, className = '') {
    const container = document.createElement('div')
    container.className = `debt__flex-row ${className}`
    
    const leftDiv = document.createElement('div')
    leftDiv.className = 'debt__flex-left'
    if (typeof leftContent === 'string') {
        leftDiv.textContent = leftContent
    } else {
        leftDiv.appendChild(leftContent)
    }
    
    const rightDiv = document.createElement('div')
    rightDiv.className = 'debt__flex-right'
    if (typeof rightContent === 'string') {
        rightDiv.textContent = rightContent
    } else {
        rightDiv.appendChild(rightContent)
    }
    
    container.appendChild(leftDiv)
    container.appendChild(rightDiv)
    
    return container
}

// на випадок різних посилань для різних податків
function createPayButton(url, text = 'Сплатити') {
    const button = createElementWithAttributes('a', 'debt__pay-button', text, {
        href: url,
        target: '_blank'
    })
    return button
}

// Податки, які показуємо в картці: назва, код бюджетної класифікації та поля з відповіді бекенду
const TAXES = [
    { type: 'non_residential_debt', title: 'Податок на нерухомість (нежитлова)', code: '18010200', urlKey: 'urlNonresident' },
    { type: 'residential_debt', title: 'Податок на нерухомість (житлова)', code: '18010300', urlKey: 'urlResident' },
    { type: 'land_debt', title: 'Податок на землю', code: '18010700', urlKey: 'urlLand' },
    { type: 'orenda_debt', title: 'Оренда землі', code: '18010900', urlKey: 'urlOrenda' },
    { type: 'mpz', title: 'Мінімальне податкове зобов\'язання', code: '11011300', urlKey: 'urlMPZ' },
]

const formatShortDate = new Intl.DateTimeFormat('uk-UA', { year: '2-digit', month: '2-digit', day: '2-digit' })
const formatAmount = (number) => `UAH ${(Number(number) || 0).toFixed(2)}`

const DEFAULT_HINT = 'Дані використовуються для перевірки заборгованості.'

// «Нічого не знайдено» від бекенду — доповнюємо порадою перевірити написання
const NOT_FOUND_TEXT = {
    taxes: 'За вашим запитом нічого не знайдено. Перевірте правильність написання прізвища, імені та по батькові.',
    utilities: 'За вказаним номером договору нічого не знайдено. Перевірте, чи правильно введено номер.',
    admin: 'За вказаним номером квитанції нічого не знайдено. Перевірте, чи правильно введено номер.',
}
const isNotFound = (text) => /нічого не знайдено|не знайден/i.test(String(text || ''))
const withNotFoundHint = (text, mode) => (isNotFound(text) ? NOT_FOUND_TEXT[mode] : text)

const setHint = (text, isError = false) => {
    const hint = document.getElementById('debt_hint')
    hint.textContent = text
    hint.classList.toggle('debt__hint--error', isError)
}

const updateUI = () => {
    const section = document.getElementById('debt')
    const container = document.getElementById('debt_info')
    container.innerHTML = ""
    section.hidden = true
    btnSubmit.classList.toggle('debt__submit--loading', state.status === statuses.Pending)

    if (state.status === statuses.Idle) {
        return setHint(DEFAULT_HINT)
    }

    if (state.status === statuses.Pending) {
        return setHint('Шукаємо дані…')
    }

    if (state.status === statuses.Error) {
        return setHint(state.error, true)
    }

    if (state.status === statuses.Success) {
        const data = state.data;
        // Текстова відповідь бекенду: "нічого не знайдено" або прохання ввести дату народження
        if (data.data && typeof data.data === "string") {
            setHint(withNotFoundHint(data.data, 'taxes'), !sendData.confirm)
            inputText.focus()
            return
        }

        setHint(DEFAULT_HINT)
        section.hidden = false

        if (data?.admin) {
            container.appendChild(createAdminCard(data))
            setTimeout(() => smoothScrollTo(section), 100);
            return
        }

        if (data?.utilities) {
            container.appendChild(createUtilitiesCard(data))
            setTimeout(() => smoothScrollTo(section), 100);
            return
        }

        const card = createElement('div', 'debt__card', '')

        // === ЗАГОЛОВОК КАРТКИ ===
        const head = createElement('div', 'debt__card-head', '')
        head.appendChild(createElement('p', 'debt__card-date', `Заборгованість станом на ${formatShortDate.format(new Date(data?.data?.date))} за запитом:`))
        head.appendChild(createElement('h2', 'debt__card-name', data?.data?.name))

        // Ідентифікатор платника: дата народження або замаскований податковий номер
        const rawId = data?.data?.identification
        const idLooksLikeDate = /^\d{4}-\d{2}-\d{2}/.test(String(rawId || ''))
        const birthDate = data?.data?.birth_date || (idLooksLikeDate ? rawId : null)
        head.appendChild(createElement('p', 'debt__card-label', birthDate ? 'Дата народження' : 'Податковий номер платника'))
        head.appendChild(createElement('p', '', birthDate
            ? formatDateUA.format(new Date(birthDate))
            : (rawId ? `*******${rawId}` : '—')))
        card.appendChild(head)

        // === СПИСОК ПОДАТКІВ ===
        // Податки із заборгованістю — першими (від більшої суми) з кнопкою «Сплатити», нульові — після них без кнопки.
        // Якщо боргів немає зовсім — замість списку напис «Заборгованості немає».
        privatUrls.clear()
        const taxes = TAXES
            .map((tax) => ({ ...tax, amount: Number(data?.data?.[tax.type]) || 0 }))
            .sort((a, b) => (b.amount > 0) - (a.amount > 0) || b.amount - a.amount)

        if (!taxes.some((tax) => tax.amount > 0)) {
            card.appendChild(createNoDebtMessage())
            container.appendChild(card)
            setTimeout(() => smoothScrollTo(section), 100);
            return
        }

        const list = createElement('ul', 'debt__list', '')
        taxes.forEach((tax) => {
            const hasDebt = tax.amount > 0
            // privat24-URL кладемо в мапу лише коли він реально є (для опції "Приват" у модалці)
            const paymentUrl = data?.data?.[tax.urlKey]
            if (hasDebt && paymentUrl) privatUrls.set(tax.type, paymentUrl)

            const item = createElement('li', 'debt__tax', '')
            item.appendChild(createElement('p', 'debt__tax-name', `${tax.title} ${tax.code}`))
            item.appendChild(createElement('p', 'debt__tax-amount', formatAmount(tax.amount)))

            if (hasDebt) {
                const payButton = createElement('button', 'button button--outline button--block debt__pay-button', 'Сплатити')
                payButton.type = 'button'
                payButton.dataset.taxType = tax.type
                payButton.dataset.taxTitle = tax.title
                item.appendChild(payButton)
            }

            list.appendChild(item)
        })
        card.appendChild(list)
        container.appendChild(card)

        // === РЕКВІЗИТИ (лише якщо є заборгованість) ===
        if (taxes.some((tax) => tax.amount > 0)) {
            const paymentDetails = createElement('div', 'debt__info-payment-details', '')
            paymentDetails.appendChild(createElement('button', 'button button--outline button--block debt__info-payment-details-btn', 'Показати реквізити для оплати'))
            paymentDetails.appendChild(createElement('div', 'debt__info-payment-details-list', ''))
            container.appendChild(paymentDetails)
        }

        // Плавне прокручування до результатів після рендерингу
        setTimeout(() => smoothScrollTo(section), 100);
        return;
    }
}

// Напис у картці, коли боргів немає зовсім
function createNoDebtMessage() {
    const box = createElement('div', 'debt__empty', '')
    box.appendChild(createElement('p', 'debt__empty-title', 'Заборгованості немає'))
    return box
}

// Відкрити сторінку оплати: вікно відкриваємо одразу (до запиту), інакше браузер заблокує його;
// requestPayment() повертає Response з { url }. Помилка — текстом під кнопкою.
async function openPayment(requestPayment, button, place, testMessage) {
    place.querySelector('.debt__pay-error')?.remove()
    const popup = window.open('', '_blank')
    const label = button.textContent
    button.disabled = true
    button.textContent = 'Готуємо оплату…'
    try {
        const res = await requestPayment()
        const body = await res.json()
        if (USE_MOCK && body?.mock) {
            popup?.document.write(`<p style="font:16px sans-serif;padding:24px">${testMessage}</p>`)
            return
        }
        if (!res.ok || !body?.url) throw new Error(body?.message || 'Немає посилання на оплату')
        if (popup && !popup.closed) popup.location.href = body.url
        else window.location.href = body.url
    } catch (error) {
        console.error('Payment failed:', error)
        popup?.close()
        place.appendChild(createElement('p', 'debt__pay-error', 'Не вдалося сформувати оплату. Спробуйте, будь ласка, пізніше.'))
    } finally {
        button.disabled = false
        button.textContent = label
    }
}

// Картка адміністративної послуги (за макетом): ліворуч — рахунок, платник, сума;
// праворуч — призначення й реквізити, кнопка «Оплатити онлайн»
function createAdminCard({ admin, identifier }) {
    const card = createElement('div', 'debt__card', '')

    const head = createElement('div', 'debt__card-head', '')
    head.appendChild(createElement('p', 'debt__card-date', 'Рахунок за запитом'))
    head.appendChild(createElement('h2', 'debt__card-name', admin.number))
    if (admin.payer) {
        head.appendChild(createElement('p', 'debt__card-label', 'Платник'))
        head.appendChild(createElement('p', 'debt__card-value', formatPersonName(admin.payer)))
    }
    head.appendChild(createElement('p', 'debt__card-label', 'Сума'))
    head.appendChild(createElement('p', 'debt__card-value', `${admin.amount.toFixed(2)} грн`))
    card.appendChild(head)

    const details = createElement('div', 'debt__details', '')
    ;[['Призначення', admin.purpose], ['ЄДРПОУ', admin.edrpou], ['МФО', admin.mfo], ['IBAN', admin.iban]]
        .filter(([, value]) => value)
        .forEach(([label, value]) => {
            details.appendChild(createElement('p', 'debt__card-label', label))
            details.appendChild(createElement('p', 'debt__details-value', value))
        })

    if (admin.amount > 0) {
        const payButton = createElement('button', 'button button--dark debt__details-pay', 'Оплатити онлайн')
        payButton.type = 'button'
        payButton.addEventListener('click', () => {
            if (admin.payUrl) return window.open(admin.payUrl, '_blank', 'noopener,noreferrer')
            openPayment(
                () => (USE_MOCK
                    ? mockAdminFetch(ADMIN_PAY_URL, identifier)
                    : fetch(ADMIN_PAY_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ identifier }),
                    })),
                payButton,
                details,
                'Тестові дані: тут відкриється сторінка оплати адміністративної послуги.'
            )
        })
        details.appendChild(payButton)
    }
    card.appendChild(details)
    return card
}

// ============================================================
// ОПЛАТА КОМУНАЛЬНОЇ ПОСЛУГИ
// Якщо бекенд у відповіді /check-utility-debt віддає посилання на оплату послуги
// (поле url / paymentUrl / payUrl / link) — відкриваємо його.
// Інакше — запит UTILITY_PAY_URL, який має повернути { url } (або { message } при помилці).
// TODO(бекенд): підставити справжню адресу й формат запиту оплати комунальних послуг.
// ============================================================
const UTILITY_PAY_URL = '/utility-pay'
const PAY_LINK_KEYS = ['url', 'paymentUrl', 'payUrl', 'link']

const mockUtilityPay = async () => {
    await new Promise((r) => setTimeout(r, MOCK.latencyMs))
    return mockResponse({ url: null, mock: true })
}

async function payUtility(item, button, row) {
    const direct = PAY_LINK_KEYS.map((key) => item[key]).find(Boolean)
    if (direct) {
        window.open(direct, '_blank', 'noopener,noreferrer')
        return
    }
    await openPayment(
        () => (USE_MOCK
            ? mockUtilityPay()
            : fetch(UTILITY_PAY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contractNumber: item.payerident ?? item.contractNumber,
                    paymentPurpose: item.paymentPurpose,
                    sum: item.amount,
                }),
            })),
        button,
        row,
        'Тестові дані: тут відкриється сторінка оплати комунальної послуги.'
    )
}

// Картка комунальної заборгованості: договір і адреса, далі послуги (з боргом — першими)
function createUtilitiesCard({ utilities, contractNumber }) {
    const first = utilities[0] || {}
    const card = createElement('div', 'debt__card', '')

    const head = createElement('div', 'debt__card-head', '')
    head.appendChild(createElement('p', 'debt__card-date', 'Заборгованість за договором:'))
    head.appendChild(createElement('h2', 'debt__card-name', first.payerident ?? first.contractNumber ?? contractNumber))
    if (first.adress) {
        head.appendChild(createElement('p', 'debt__card-label', 'Адреса'))
        head.appendChild(createElement('p', '', first.adress))
    }
    card.appendChild(head)

    if (!utilities.some((item) => (Number(item.charge) || 0) > 0)) {
        card.appendChild(createNoDebtMessage())
        return card
    }

    const list = createElement('ul', 'debt__list', '')
    utilities
        .map((item) => ({ ...item, amount: Number(item.charge) || 0 }))
        .sort((a, b) => (b.amount > 0) - (a.amount > 0) || b.amount - a.amount)
        .forEach((item) => {
            const row = createElement('li', 'debt__tax', '')
            row.appendChild(createElement('p', 'debt__tax-name', item.paymentPurpose || 'Комунальна послуга'))
            // адреса окремої послуги — лише якщо вона інша, ніж у заголовку
            if (item.adress && item.adress !== first.adress) {
                row.appendChild(createElement('p', 'debt__tax-address', item.adress))
            }
            row.appendChild(createElement('p', 'debt__tax-amount', formatAmount(item.amount)))
            if (item.amount > 0) {
                const payButton = createElement('button', 'button button--outline button--block debt__pay-button', 'Сплатити')
                payButton.type = 'button'
                payButton.dataset.utility = 'true'
                payButton.addEventListener('click', () => payUtility({ ...item, contractNumber }, payButton, row))
                row.appendChild(payButton)
            }
            list.appendChild(row)
        })
    card.appendChild(list)
    return card
}

updateUI()

const detailsRequisite = (nameRequisite, fullname, sum, dataRequisite) => {
    const requisite = dataRequisite?.split("\n")
    return `
    <div class="debt__info-card debt__info-card--payment">
                            <h3 class="title debt__info-card-title">
                                ${nameRequisite}
                            </h3>
                            <p class="paragraph paragraph--sm debt__info-card-type">
                                Платник
                            </p>
                            <h3 class="paragraph paragraph--lg debt__info-card-value">
                                ${fullname}
                            </h3>
                            <p class="paragraph paragraph--sm debt__info-card-type">
                                Сума
                            </p>
                            <p class="paragraph debt__info-card-value">
                                ${formatLocale(sum)}
                            </p>
                            <p class="paragraph paragraph--sm debt__info-card-type">
                                ${requisite[0].split(':')[0]}
                            </p>
                            <p class="paragraph debt__info-card-value">
                                ${requisite[0].split(':')[1]}
                            </p>
                            <p class="paragraph paragraph--sm debt__info-card-type">
                            ${requisite[1].split(':')[0]}
                            </p>
                            <p class="paragraph debt__info-card-value">
                            ${requisite[1].split(':')[1]}
                            </p>
                            <p class="paragraph paragraph--sm debt__info-card-type">
                            ${requisite[2].split(':')[0]}
                            </p>
                            <p class="paragraph debt__info-card-value">
                            ${requisite[2].split(':')[1]}
                            </p>

                        </div>
    `
}

// Функція для генерації PDF з реквізитами за допомогою html2pdf
const generatePDF = () => {
    const data = state.data;
    if (!data?.data) return;

    // Створюємо HTML контейнер для PDF
    const pdfContent = document.createElement('div');
    pdfContent.style.padding = '20px';
    pdfContent.style.fontFamily = 'Arial, sans-serif';
    pdfContent.style.color = '#000';
    pdfContent.style.backgroundColor = '#fff';

    // Додаємо заголовок
    const header = document.createElement('div');
    header.style.textAlign = 'center';
    header.style.marginBottom = '20px';
    header.innerHTML = `
        <h1 style="font-size: 24px; margin-bottom: 10px;">Реквізити для оплати</h1>
        <p style="font-size: 14px; color: #666;">Станом на ${formatDateUA.format(new Date(data?.data?.date))}</p>
    `;
    pdfContent.appendChild(header);

    // Додаємо ім'я платника
    const payerInfo = document.createElement('div');
    payerInfo.style.marginBottom = '20px';
    payerInfo.innerHTML = `
        <p style="font-weight: bold; margin-bottom: 5px;">Платник:</p>
        <p style="font-size: 16px;">${data?.data?.name || ''}</p>
    `;
    pdfContent.appendChild(payerInfo);

    // Функція для додавання секції реквізитів
    const addRequisiteSection = (title, amount, requisiteData) => {
        if (amount === 0 || !requisiteData) return;

        const section = document.createElement('div');
        section.style.marginBottom = '25px';
        section.style.paddingTop = '15px';
        section.style.borderTop = '2px solid #ddd';
        // Запобігаємо розриву секції між сторінками
        section.style.pageBreakInside = 'avoid';
        section.style.breakInside = 'avoid';

        let requisiteHTML = `
            <h3 style="font-size: 18px; margin-bottom: 10px; color: #333;">${title}</h3>
            <p style="margin-bottom: 10px;"><strong>Сума:</strong> ${formatLocale(amount)}</p>
        `;

        // Парсинг реквізитів
        const requisiteLines = requisiteData.split('\n');
        requisiteLines.forEach(line => {
            if (line.trim()) {
                const [key, value] = line.split(':').map(s => s.trim());
                if (key && value) {
                    requisiteHTML += `<p style="margin: 5px 0;"><strong>${key}:</strong> ${value}</p>`;
                }
            }
        });

        section.innerHTML = requisiteHTML;
        pdfContent.appendChild(section);
    };

    // Додаємо всі реквізити
    addRequisiteSection(
        'Податок на нерухомість (нежитлова)',
        data?.data?.non_residential_debt,
        data?.data?.requisite_non_residential_debt
    );

    addRequisiteSection(
        'Податок на нерухомість (житлова)',
        data?.data?.residential_debt,
        data?.data?.requisite_residential_debt
    );

    addRequisiteSection(
        'Податок на землю',
        data?.data?.land_debt,
        data?.data?.requisite_land_debt
    );

    addRequisiteSection(
        'Оренда землі',
        data?.data?.orenda_debt,
        data?.data?.requisite_orenda_debt
    );

    addRequisiteSection(
        'Мінімальне податкове зобов\'язання',
        data?.data?.mpz,
        data?.data?.requisite_mpz
    );

    // Налаштування для html2pdf
    const options = {
        margin: [10, 10, 10, 10],
        filename: `Реквізити_${data?.data?.name?.replace(/\s+/g, '_')}_${formatDateUA.format(new Date(data?.data?.date)).replace(/\./g, '-')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            letterRendering: true,
            logging: false
        },
        jsPDF: {
            unit: 'mm',
            format: 'a4',
            orientation: 'portrait'
        },
        pagebreak: {
            mode: ['avoid-all', 'css', 'legacy'],
            avoid: ['div', 'p']
        }
    };

    // Генеруємо та зберігаємо PDF
    html2pdf().set(options).from(pdfContent).save();
}


function ensurePaymentModal() {
    if (document.querySelector('.debt__modal-overlay')) return
    const overlay = document.createElement('div')
    overlay.className = 'debt__modal-overlay'
    overlay.innerHTML = `
      <div class="debt__modal" role="dialog" aria-modal="true" aria-labelledby="debt-modal-title">
        <div class="debt__modal-header">
          <h3 class="debt__modal-title" id="debt-modal-title">Оберіть банк для оплати</h3>
          <button class="debt__modal-close" type="button" aria-label="Закрити">×</button>
        </div>
        <p class="debt__modal-subtitle"></p>
        <div class="debt__modal-options">
          <button class="debt__modal-bank-option debt__modal-bank-option--privat" type="button">
            <img src="${PrivatLogo}" alt="" class="debt__modal-bank-logo" />
            <span class="debt__modal-bank-label">Приват</span>
          </button>
          <button class="debt__modal-bank-option debt__modal-bank-option--mtb" type="button">
            <img src="${MtbLogo}" alt="" class="debt__modal-bank-logo" />
            <span class="debt__modal-bank-label">МТБ Банк</span>
          </button>
        </div>
        <p class="debt__modal-error" hidden></p>
      </div>`
    document.body.appendChild(overlay)
}

function openPaymentModal({ taxType, taxTitle }) {
    ensurePaymentModal()
    const overlay = document.querySelector('.debt__modal-overlay')
    overlay.dataset.taxType = taxType
    overlay.querySelector('.debt__modal-subtitle').textContent = taxTitle
    overlay.querySelector('.debt__modal-error').hidden = true
    overlay.querySelectorAll('.debt__modal-bank-option').forEach(b => {
        b.disabled = false
        b.classList.remove('debt__modal-bank-option--loading')
    })

    // Опцію "Приват" показуємо лише коли для цього податку прийшло privat24-посилання.
    // Ховаємо через inline display:none, бо .debt__modal-bank-option має display:flex,
    // який перебиває HTML-атрибут hidden.
    const privatOption = overlay.querySelector('.debt__modal-bank-option--privat')
    if (privatOption) {
        const hasPrivat = privatUrls.has(taxType)
        privatOption.style.display = hasPrivat ? '' : 'none'
        privatOption.disabled = !hasPrivat
    }

    overlay.classList.add('debt__modal-overlay--open')
}

function closePaymentModal() {
    if (activeMtbController) {
        activeMtbController.abort()
        activeMtbController = null
    }
    document.querySelector('.debt__modal-overlay')?.classList.remove('debt__modal-overlay--open')
}


// ============================================================
// ВАЛІДАЦІЯ ПОЛЯ ПОШУКУ
// ПІБ: лише українські літери, апостроф і дефіс; рівно три слова, кожне — від 2 літер.
// Крок уточнення: дата народження ДД.ММ.РРРР.
// Під час введення показуємо лише помилки, які вже точно є (зайві символи, забагато слів);
// «незавершене» (менше трьох слів, коротке слово) — лише після виходу з поля або спроби пошуку.
// Кнопка пошуку неактивна, поки значення не валідне.
// ============================================================
const UA = 'А-ЩЬЮЯЄІЇҐа-щьюяєіїґ'
const APOSTROPHES = '\'’ʼ`'
const NAME_CHARS = new RegExp(`^[${UA}${APOSTROPHES}\\-\\s]*$`)
// слово: літери, всередині — апостроф (Дем’янчук) або дефіс (Петренко-Іваненко)
const NAME_WORD = new RegExp(`^[${UA}]+(?:[${APOSTROPHES}-][${UA}]+)*$`)

const validateName = (value, final) => {
    const name = value.trim().replace(/\s+/g, ' ')
    if (!name) return final ? 'Введіть прізвище, ім’я та по батькові.' : ''
    if (!NAME_CHARS.test(value)) return 'Використовуйте лише українські літери, апостроф і дефіс.'
    const words = name.split(' ')
    if (words.length > 3) return 'Введіть лише три слова: прізвище, ім’я та по батькові.'
    if (!final) return ''
    if (words.length < 3) return 'Введіть прізвище, ім’я та по батькові — три слова.'
    if (words.some((w) => w.replace(new RegExp(`[${APOSTROPHES}-]`, 'g'), '').length < 2)) {
        return 'Кожне слово має містити щонайменше 2 літери.'
    }
    if (!words.every((w) => NAME_WORD.test(w))) return 'Апостроф і дефіс можуть стояти лише між літерами.'
    return ''
}

const validateBirthDate = (value, final) => {
    const date = value.trim()
    if (!date) return final ? 'Введіть дату народження у форматі ДД.ММ.РРРР.' : ''
    if (/[^\d./-]/.test(date)) return 'Дату вводьте цифрами у форматі ДД.ММ.РРРР.'
    if (!final) return ''
    const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(date)
    if (!m) return 'Введіть дату народження у форматі ДД.ММ.РРРР.'
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const parsed = new Date(y, mo - 1, d)
    const exists = parsed.getFullYear() === y && parsed.getMonth() === mo - 1 && parsed.getDate() === d
    if (!exists || y < 1900 || parsed > new Date()) return 'Такої дати народження не може бути. Перевірте, будь ласка.'
    return ''
}

// Номер договору: цифри, літери, дефіс, скісна риска; 3–30 значущих символів
const CONTRACT_CHARS = new RegExp(`^[0-9A-Za-z${UA}/\\-\\s]*$`)
const validateContract = (value, final) => {
    const contract = value.trim()
    if (!contract) return final ? 'Введіть номер договору.' : ''
    if (!CONTRACT_CHARS.test(contract)) return 'Номер договору може містити лише цифри, літери, «-» і «/».'
    if (!final) return ''
    const significant = contract.replace(/[\s\/-]/g, '')
    if (significant.length < 3) return 'Номер договору занадто короткий.'
    if (significant.length > 30) return 'Номер договору занадто довгий.'
    return ''
}

// Номер квитанції адміністративної послуги: рівно 6 цифр
const validateReceipt = (value, final) => {
    const receipt = value.trim()
    if (!receipt) return final ? 'Введіть 6-значний номер квитанції.' : ''
    if (/\D/.test(receipt)) return 'Номер квитанції складається лише з цифр.'
    if (receipt.length > 6) return 'Номер квитанції має 6 цифр.'
    if (!final) return ''
    if (receipt.length < 6) return 'Номер квитанції має 6 цифр.'
    return ''
}

const validateInput = (final) => {
    if (searchMode === 'utilities') return validateContract(inputText.value, final)
    if (searchMode === 'admin') return validateReceipt(inputText.value, final)
    return (sendData.confirm ? validateBirthDate : validateName)(inputText.value, final)
}

// кнопка активна лише для валідного значення і не під час запиту
function updateSubmitState() {
    btnSubmit.disabled = state.status === statuses.Pending || validateInput(true) !== ''
}

const showValidation = (final) => {
    const error = validateInput(final)
    if (error) setHint(error, true)
    else setHint(sendData.confirm ? 'Введіть дату народження у форматі ДД.ММ.РРРР.' : DEFAULT_HINT)
    return error
}

// у полі ПІБ лишається таким, як його ввела людина; у картці, реквізитах і PDF
// воно показується великими літерами (див. formatPersonName)
inputText.addEventListener('input', () => {
    if (!sendData.confirm) sendData.value = inputText.value
    else sendData.ident = inputText.value
    updateSubmitState()
    showValidation(false)
})

// вийшли з поля — показуємо й «незавершені» помилки (якщо щось введено)
inputText.addEventListener('blur', () => {
    if (inputText.value.trim()) showValidation(true)
})

// Enter при неактивній кнопці форма не відправляє — пояснюємо, що не так
inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && btnSubmit.disabled && state.status !== statuses.Pending) {
        e.preventDefault()
        showValidation(true)
    }
})

// ============================================================
// РЕЖИМИ ПОШУКУ: «податки» (за ПІБ), «комунальні послуги» (за номером договору)
// і «адміністративні послуги» (за 6-значним номером квитанції).
// На головній перемикаються картками в «Інструментах» (data-search-switch="utilities" / "admin"):
// картка вмикає свій режим, а в ньому сама стає «Переглянути заборгованість по податках»;
// сторінка utilities.html — лише комунальні послуги (<body data-search-only="utilities">).
// ============================================================
const SEARCH_MODES = {
    taxes: {
        title: 'Портал місцевих податків Шептицької громади',
        text: 'Введіть прізвище, імʼя та по-батькові, наприклад: Шептицький Андрей Іванович',
        placeholder: 'Прізвище ім’я по-батькові',
        autocapitalize: 'words',
    },
    utilities: {
        title: 'Комунальні послуги Шептицької громади',
        text: 'Введіть номер договору (особового рахунку), щоб перевірити заборгованість за комунальні послуги',
        placeholder: 'Номер договору',
        autocapitalize: 'characters',
    },
    admin: {
        title: 'Пошук та оплата адміністративних послуг',
        text: 'Введіть 6-значний номер квитанції для пошуку та оплати',
        placeholder: 'Номер квитанції',
        autocapitalize: 'off',
    },
}

// підписи карток-перемикачів в «Інструментах»
const SWITCH_LABELS = {
    utilities: 'Переглянути заборгованість по комунальних послугах',
    admin: 'Оплата адміністративних послуг',
}
const BACK_TO_TAXES_LABEL = 'Переглянути заборгованість по податках'

let searchMode = document.body.dataset.searchOnly === 'utilities' ? 'utilities' : 'taxes'

function applySearchMode() {
    const mode = SEARCH_MODES[searchMode]
    const title = document.querySelector('.intro__title')
    const text = document.querySelector('.intro__text')
    const label = document.querySelector('label[for="debt_input"]')
    if (title) title.textContent = mode.title
    if (text) text.textContent = mode.text
    if (label) label.textContent = mode.placeholder
    inputText.placeholder = mode.placeholder
    inputText.setAttribute('autocapitalize', mode.autocapitalize)
    inputText.setAttribute('autocomplete', searchMode === 'taxes' ? 'name' : 'off')
    inputText.setAttribute('inputmode', searchMode === 'admin' ? 'numeric' : 'text')
    document.querySelectorAll('[data-search-switch]').forEach((button) => {
        const target = button.dataset.searchSwitch
        const label = button.querySelector('.tools__label')
        if (label) label.textContent = searchMode === target ? BACK_TO_TAXES_LABEL : SWITCH_LABELS[target]
    })
}

function setSearchMode(mode) {
    searchMode = mode
    // скидаємо пошук: поле, уточнення за датою народження, результат
    sendData = { value: '', ident: '', confirm: false }
    inputText.value = ''
    state.status = statuses.Idle
    state.error = ''
    state.data = []
    applySearchMode()
    updateUI()
    updateSubmitState()
}

// сторінка лише з комунальними послугами — без перемикача на податки, своя назва в шапці
if (document.body.dataset.searchOnly) {
    document.querySelectorAll('[data-search-switch]').forEach((el) => el.closest('li')?.remove())
    const brand = document.querySelector('.header__brand-text')
    if (brand) brand.innerHTML = 'Портал комунальних послуг<br>Шептицької громади'
    document.querySelector('.header__brand')?.setAttribute('aria-label', 'Портал комунальних послуг Шептицької громади — на початок сторінки')
}

document.querySelectorAll('[data-search-switch]').forEach((button) => {
    button.addEventListener('click', () => {
        const target = button.dataset.searchSwitch
        setSearchMode(searchMode === target ? 'taxes' : target)
        // нагору до пошуку, курсор — у поле (зупиняємо прокрутку до результату, якщо вона ще йде)
        cancelSmoothScroll()
        window.scrollTo({ top: 0, behavior: 'smooth' })
        setTimeout(() => inputText.focus({ preventScroll: true }), 400)
    })
})

applySearchMode()
updateSubmitState()

submitForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.status === statuses.Pending || showValidation(true)) return
    if (searchMode === 'utilities') {
        await fetchUtilities(inputText.value.trim().replace(/\s+/g, ' '))
    } else if (searchMode === 'admin') {
        await fetchAdminService(inputText.value.trim())
    } else if (!sendData.confirm) {
        await fetchData({ username: sendData.value.trim().replace(/\s+/g, ' ') }, '/info')
    } else {
        // Нормалізуємо введену дату народження ДД.ММ.РРРР -> yyyy-mm-dd для звірки на бекенді
        await fetchData({ username: sendData.value, ident: toISODate(sendData.ident) }, '/confirm')
    }
})


document.addEventListener('click', (event) => {
    if (event.target && event.target.classList.contains('debt__info-payment-details-btn')) {
        const data = state.data;
        const detailsBtn = document.querySelector('.debt__info-payment-details-btn');
        const detailsList = document.querySelector('.debt__info-payment-details-list');
        detailsBtn.disabled=true
        detailsList.style.opacity = 1;
        detailsList.style.paddingTop = '24px';
        TAXES.forEach((tax) => {
            const amount = Number(data?.data?.[tax.type]) || 0
            const requisite = data?.data?.[`requisite_${tax.type}`]
            if (amount > 0 && requisite) {
                detailsList.innerHTML += detailsRequisite(tax.title, data?.data?.name, amount, requisite)
            }
        })

        // Додаємо кнопку для завантаження PDF
        const pdfButtonContainer = document.createElement('div');
        pdfButtonContainer.className = 'debt__pdf-button-container';
        const pdfButton = document.createElement('button');
        pdfButton.className = 'button button--dark debt__pdf-download-btn';
        pdfButton.textContent = 'Завантажити PDF';
        pdfButtonContainer.appendChild(pdfButton);
        detailsList.appendChild(pdfButtonContainer);
    }

    // Обробник для кнопки завантаження PDF
    if (event.target && event.target.classList.contains('debt__pdf-download-btn')) {
        generatePDF();
    }
});


document.addEventListener('click', async (event) => {
    const t = event.target

    // кнопки оплати комунальних послуг мають власний обробник (payUtility)
    if (t.classList && t.classList.contains('debt__pay-button') && !t.dataset.utility) {
        openPaymentModal({ taxType: t.dataset.taxType, taxTitle: t.dataset.taxTitle })
        return
    }

    if (t.classList && (t.classList.contains('debt__modal-overlay') || t.classList.contains('debt__modal-close'))) {
        closePaymentModal()
        return
    }

    if (t.closest && t.closest('.debt__modal-bank-option--privat')) {
        const overlay = document.querySelector('.debt__modal-overlay')
        const taxType = overlay?.dataset.taxType
        const url = privatUrls.get(taxType)
        if (url) window.open(url, '_blank', 'noopener,noreferrer')
        closePaymentModal()
        return
    }

    const mtbBtn = t.closest && t.closest('.debt__modal-bank-option--mtb')
    if (mtbBtn) {
        const overlay = document.querySelector('.debt__modal-overlay')
        const taxType = overlay.dataset.taxType
        const errEl = overlay.querySelector('.debt__modal-error')
        errEl.hidden = true

        const popup = window.open('', '_blank')

        if (popup) {
            popup.document.write(`
                <html>
                  <head>
                    <title>Переадресація...</title>
                  </head>
                  <body style="
                    display:flex;
                    justify-content:center;
                    align-items:center;
                    height:100vh;
                    font-family:sans-serif;
                  ">
                    <div>
                      <h2>Підготовка платежу...</h2>
                    </div>
                  </body>
                </html>
            `)
        }

        mtbBtn.disabled = true
        mtbBtn.classList.add('debt__modal-bank-option--loading')
        activeMtbController = new AbortController()

        try {
            const res = await fetch('/payplace-pay', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: state.data?.data?.id, type: taxType }),
                signal: activeMtbController.signal,
            })
            const data = await res.json()
            if (!res.ok || data.error || !data.url) {
                if (popup) popup.close()
                errEl.textContent = data.message || 'Не вдалось сформувати платіжну інструкцію. Спробуйте пізніше.'
                errEl.hidden = false
            } else {
                if (popup && !popup.closed) {
                    popup.location.href = data.url
                    closePaymentModal()
                } else {
                    errEl.innerHTML = `Посилання: <a href="${data.url}" target="_blank" rel="noopener noreferrer">Перейти до оплати</a>`
                    errEl.hidden = false
                }
            }
        } catch (e) {
            if (popup) popup.close()
            if (e.name !== 'AbortError') {
                errEl.textContent = 'Помилка мережі. Перевірте з\'єднання.'
                errEl.hidden = false
            }
        } finally {
            mtbBtn.disabled = false
            mtbBtn.classList.remove('debt__modal-bank-option--loading')
            activeMtbController = null
        }
    }
})

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePaymentModal()
})