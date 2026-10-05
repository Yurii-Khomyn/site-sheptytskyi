// styles
import 'modern-normalize/modern-normalize.css';
import 'Src/assets/fonts/fonts.scss';
import 'Src/styles/styles.scss';
// components
import { lazyLoadImages } from 'Components/lazyLoadImages/lazyLoadImages';
import 'Components/lazyLoadImages/lazyLoadImages.scss';
import 'Components/button/button.scss';
import { hideLoadingScreen } from 'Sections/LoadingScreen/LoadingScreen';
// sections
import 'Sections/Header/Header.scss';
import 'Sections/Intro/Intro.scss';
import 'Sections/Debt/Debt';
import 'Sections/Questions/Questions.scss';
import 'Sections/Tools/Tools.scss';
import 'Sections/Examples/Examples.scss';
import 'Sections/Footer/Footer.scss';

// ============================================================
// Смуги Safari на iPhone (iOS 26) — див. коментар у styles.scss.
// Верх: синя смужка .safari-top-tint, лише поки сторінка на самому верху.
// Фон сторінки: на самому верху — колір верху градієнта (частина версій Safari фарбує ним
// смугу під годинником, ігноруючи смужку); після прокрутки — колір секції біля нижнього краю
// екрана (градієнт → його низ, футер → чорний тощо), для смуги під нижньою панеллю.
// ============================================================
const safariTopTint = document.querySelector('.safari-top-tint');
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
    // на самому верху — колір верху градієнта: частина версій Safari фарбує ним смугу під годинником;
    // після прокрутки — колір секції біля нижнього краю (для смуги під нижньою панеллю)
    const color = atTop ? GRADIENT_TOP : sectionColorAtBottom();
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

window.addEventListener('DOMContentLoaded', () => {
    // hide the loading screen
    hideLoadingScreen();
    // load the images
    lazyLoadImages();
});
