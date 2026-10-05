import './Debt.scss';
import PrivatLogo from '../../assets/images/icons/ic_privat24.svg'
import MtbLogo from '../../assets/images/icons/ic_mtb.svg'
import html2pdf from 'html2pdf.js';

// Smooth scroll function with easing
const smoothScrollTo = (targetElement) => {
    if (!targetElement) return;

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
            requestAnimationFrame(animation);
        }
    };

    requestAnimationFrame(animation);
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

// ПІБ для показу й документів: кожне слово (і кожна частина подвійного прізвища) — з великої,
// решта — малі; після апострофа літера лишається малою (Дем’янчук). «тирко НАДІЯ» → «Тирко Надія»
const formatPersonName = (s) => (s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('uk')
    .replace(/(^|[\s-])(\S)/g, (_, sep, letter) => sep + letter.toLocaleUpperCase('uk'))

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
    json: async () => body,
})

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
        // як би людина не ввела ПІБ, у картці, реквізитах і PDF воно буде в правильному регістрі
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
            setHint(data.data, !sendData.confirm)
            inputText.focus()
            return
        }

        setHint(DEFAULT_HINT)
        section.hidden = false

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
        // Податки із заборгованістю — першими (від більшої суми), нульові — після них з неактивною кнопкою
        privatUrls.clear()
        const taxes = TAXES
            .map((tax) => ({ ...tax, amount: Number(data?.data?.[tax.type]) || 0 }))
            .sort((a, b) => (b.amount > 0) - (a.amount > 0) || b.amount - a.amount)

        const list = createElement('ul', 'debt__list', '')
        taxes.forEach((tax) => {
            const hasDebt = tax.amount > 0
            // privat24-URL кладемо в мапу лише коли він реально є (для опції "Приват" у модалці)
            const paymentUrl = data?.data?.[tax.urlKey]
            if (hasDebt && paymentUrl) privatUrls.set(tax.type, paymentUrl)

            const item = createElement('li', 'debt__tax', '')
            item.appendChild(createElement('p', 'debt__tax-name', `${tax.title} ${tax.code}`))
            item.appendChild(createElement('p', 'debt__tax-amount', formatAmount(tax.amount)))

            const payButton = createElement('button', 'button button--outline button--block debt__pay-button', 'Сплатити')
            payButton.type = 'button'
            payButton.disabled = !hasDebt
            payButton.dataset.taxType = tax.type
            payButton.dataset.taxTitle = tax.title
            item.appendChild(payButton)

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

const validateInput = (final) => (sendData.confirm ? validateBirthDate : validateName)(inputText.value, final)

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
// воно показується правильно — кожне слово з великої (див. formatPersonName)
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

updateSubmitState()

submitForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.status === statuses.Pending || showValidation(true)) return
    if (!sendData.confirm) {
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

    if (t.classList && t.classList.contains('debt__pay-button')) {
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