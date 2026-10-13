// Окрема версія сайту: лише перевірка заборгованості за комунальні послуги.
// styles
import 'modern-normalize/modern-normalize.css';
import 'Src/assets/fonts/fonts.scss';
import 'Src/styles/styles.scss';
// components
import { lazyLoadImages } from 'Components/lazyLoadImages/lazyLoadImages';
import 'Components/lazyLoadImages/lazyLoadImages.scss';
import 'Components/button/button.scss';
import 'Components/safariTint/safariTint';
import { hideLoadingScreen } from 'Sections/LoadingScreen/LoadingScreen';
// sections
import 'Sections/Header/Header.scss';
import 'Sections/Intro/Intro.scss';
import 'Sections/Debt/Debt';
import 'Sections/Tools/Tools.scss';
import 'Sections/Footer/Footer.scss';

window.addEventListener('DOMContentLoaded', () => {
    hideLoadingScreen();
    lazyLoadImages();
});
