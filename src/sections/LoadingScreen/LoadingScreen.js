const hideLoadingScreen = () => {
    // body
    const body = document.body;
    body.style.overflow = 'auto';

    // loading screen
    const loadingScreen = document.querySelector('.loadingScreen');
    loadingScreen.classList.add('loadingScreen--hidden');

    setTimeout(() => {
        // remove the loading screen
        loadingScreen.remove();
        // remove the <style> tag
        document.querySelector('#loadingScreenStyles').remove();
    }, 350);
};

export { hideLoadingScreen };
