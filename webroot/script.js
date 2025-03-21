// /** @typedef {import('../src/message.ts').DevvitSystemMessage} DevvitSystemMessage */
// /** @typedef {import('../src/message.ts').WebViewMessage} WebViewMessage */

// class App {
//   constructor() {
//     // Get references to the HTML elements
//     this.output = /** @type {HTMLPreElement} */ (document.querySelector('#messageOutput'));
//     this.increaseButton = /** @type {HTMLButtonElement} */ (
//       document.querySelector('#btn-increase')
//     );
//     this.decreaseButton = /** @type {HTMLButtonElement} */ (
//       document.querySelector('#btn-decrease')
//     );
//     this.usernameLabel = /** @type {HTMLSpanElement} */ (document.querySelector('#username'));
//     this.counterLabel = /** @type {HTMLSpanElement} */ (document.querySelector('#counter'));
//     this.counter = 0;

//     // When the Devvit app sends a message with `postMessage()`, this will be triggered
//     addEventListener('message', this.#onMessage);

//     // This event gets called when the web view is loaded
//     addEventListener('load', () => {
//       postWebViewMessage({ type: 'webViewReady' });
//     });

//     this.increaseButton.addEventListener('click', () => {
//       // Sends a message to the Devvit app
//       postWebViewMessage({ type: 'setCounter', data: { newCounter: this.counter + 1 } });
//     });

//     this.decreaseButton.addEventListener('click', () => {
//       // Sends a message to the Devvit app
//       postWebViewMessage({ type: 'setCounter', data: { newCounter: this.counter - 1 } });
//     });
//   }

//   /**
//    * @arg {MessageEvent<DevvitSystemMessage>} ev
//    * @return {void}
//    */
//   #onMessage = (ev) => {
//     // Reserved type for messages sent via `context.ui.webView.postMessage`
//     if (ev.data.type !== 'devvit-message') return;
//     const { message } = ev.data.data;

//     // Always output full message
//     this.output.replaceChildren(JSON.stringify(message, undefined, 2));

//     switch (message.type) {
//       case 'initialData': {
//         // Load initial data
//         const { username, currentCounter } = message.data;
//         this.usernameLabel.innerText = username;
//         this.counter = currentCounter;
//         this.counterLabel.innerText = `${this.counter}`;
//         break;
//       }
//       case 'updateCounter': {
//         const { currentCounter } = message.data;
//         this.counter = currentCounter;
//         this.counterLabel.innerText = `${this.counter}`;
//         break;
//       }
//       default:
//         /** to-do: @satisifes {never} */
//         const _ = message;
//         break;
//     }
//   };
// }

// /**
//  * Sends a message to the Devvit app.
//  * @arg {WebViewMessage} msg
//  * @return {void}
//  */
// function postWebViewMessage(msg) {
//   parent.postMessage(msg, '*');
// }

// new App();
/** @typedef {import('../src/message.ts').DevvitSystemMessage} DevvitSystemMessage */
/** @typedef {import('../src/message.ts').WebViewMessage} WebViewMessage */

class App {
  constructor() {
    this.output = /** @type {HTMLPreElement} */ (document.querySelector('#messageOutput'));
    this.inputField = /** @type {HTMLInputElement} */ (document.querySelector('#word-input'));
    this.submitButton = /** @type {HTMLButtonElement} */ (
      document.querySelector('#btn-submit')
    );
    this.resultLabel = /** @type {HTMLSpanElement} */ (document.querySelector('#result'));

    addEventListener('message', this.#onMessage);

    addEventListener('load', () => {
      postWebViewMessage({ type: 'webViewReady' });
    });

    this.submitButton.addEventListener('click', () => {
      const userGuess = this.inputField.value;
      postWebViewMessage({ type: 'guessWord', data: { guess: userGuess } });
    });
  }

  /**
   * @arg {MessageEvent<DevvitSystemMessage>} ev
   * @return {void}
   */
  #onMessage = (ev) => {
    if (ev.data.type !== 'devvit-message') return;
    const { message } = ev.data.data;

    this.output.replaceChildren(JSON.stringify(message, undefined, 2));

    switch (message.type) {
      case 'initialData': {
        this.resultLabel.innerText = message.data.result;
        break;
      }
      case 'updateResult': {
        this.resultLabel.innerText = message.data.result;
        break;
      }
      default:
        const _ = message;
        break;
    }
  };
}

/**
 * Sends a message to the Devvit app.
 * @arg {WebViewMessage} msg
 * @return {void}
 */
function postWebViewMessage(msg) {
  parent.postMessage(msg, '*');
}

new App();