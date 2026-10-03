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

window.addEventListener('DOMContentLoaded', () => {
    // hide the loading screen
    hideLoadingScreen();
    // load the images
    lazyLoadImages();
});
