/*
 * Oplæsning af øvelser med computerens indbyggede stemmer (Web Speech API).
 * Bruges når overlayet ikke kan ses, fx når et spil kører i eksklusiv fuldskærm.
 */
(function (global) {
  'use strict';

  const supported = typeof global.speechSynthesis !== 'undefined';

  // Stemmerne indlæses asynkront – vent kort på dem.
  function waitForVoices(timeout = 1500) {
    return new Promise((resolve) => {
      if (!supported || global.speechSynthesis.getVoices().length > 0) return resolve();
      const timer = setTimeout(resolve, timeout);
      global.speechSynthesis.addEventListener(
        'voiceschanged',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  function danishVoice() {
    if (!supported) return null;
    return global.speechSynthesis.getVoices().find((voice) => /^da\b|^da-/i.test(voice.lang)) || null;
  }

  // Læser teksten op. Returnerer navnet på den danske stemme (eller null, hvis der ikke er en).
  async function speak(text) {
    if (!supported) return null;
    await waitForVoices();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = danishVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = 'da-DK';
    global.speechSynthesis.cancel();
    global.speechSynthesis.speak(utterance);
    return voice ? voice.name : null;
  }

  global.Speech = { supported, waitForVoices, danishVoice, speak };
})(window);
