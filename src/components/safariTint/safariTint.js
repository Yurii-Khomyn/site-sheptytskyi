// ============================================================
// Смуги Safari на iPhone (iOS 26) — див. коментар у styles.scss.
// Верх: синя смужка .safari-top-tint, лише поки сторінка на самому верху.
// Фон сторінки: на самому верху — колір верху градієнта (частина версій Safari фарбує ним
// смугу під годинником, ігноруючи смужку); після прокрутки — колір секції біля нижнього краю
// екрана (градієнт → його низ, футер → чорний тощо), для смуги під нижньою панеллю.
// ============================================================
const safariTopTint = document.querySelector('.safari-top-tint');
const topSection = document.querySelector('.top');
const GRADIENT_TOP = '#8fb8e8';
const GRADIENT_BOTTOM = '#d4e8b9';

const isFixedLayer = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).position === 'fixed') return true;
    }
    return false;
};

const sectionColorAtBottom = () => {
    // пропускаємо закріплені шари (екран завантаження, вікно вибору банку)
    let el = document
        .elementsFromPoint(window.innerWidth / 2, window.innerHeight - 1)
        .find((node) => !isFixedLayer(node));
    while (el && el !== document.body) {
        if (el.classList.contains('top')) return GRADIENT_BOTTOM;
        const color = getComputedStyle(el).backgroundColor;
        if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
        el = el.parentElement;
    }
    return null;
};

let tintFrame = 0;
const updateSafariTints = () => {
    tintFrame = 0;
    const atTop = window.scrollY <= 4;
    safariTopTint?.classList.toggle('is-hidden', !atTop);
    // поки на екрані видно хоч частину першого екрана — колір верху градієнта: Safari фарбує ним
    // смугу під годинником і показує його, коли сторінку «відтягує» вгорі при швидкій прокрутці;
    // далі — колір секції біля нижнього краю (для смуги під нижньою панеллю)
    const heroVisible = (topSection?.getBoundingClientRect().bottom ?? 0) > 0;
    const color = heroVisible ? GRADIENT_TOP : sectionColorAtBottom();
    if (color) {
        document.documentElement.style.backgroundColor = color;
        document.body.style.backgroundColor = color;
    }
};
const scheduleSafariTints = () => {
    if (!tintFrame) tintFrame = requestAnimationFrame(updateSafariTints);
};
window.addEventListener('scroll', scheduleSafariTints, { passive: true });
window.addEventListener('resize', scheduleSafariTints);
window.addEventListener('load', () => setTimeout(updateSafariTints, 400)); // після зникнення екрана завантаження
updateSafariTints();
