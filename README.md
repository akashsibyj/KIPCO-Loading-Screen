# KIPCO Loading Screen

An animated KIPCO loading screen built with plain HTML, CSS and JavaScript (SVG graphics, no libraries).

## Run it

You need Node.js (the same as your dashboard). In a terminal in this folder (in VS Code: Terminal → New Terminal):

```bash
npm start
```

Then open **http://localhost:3000**. If port 3000 is already in use (for example by the dashboard), it automatically uses 3001, 3002 and so on, and prints the address. Press **Ctrl+C** to stop.

There are no dependencies, so `npm install` isn't needed. Running it anyway is harmless.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The page that shows the loading screen. `--kl-size` sets the size (0.55 = about half the screen) |
| `server.js` | Small built-in Node web server used by `npm start` |
| `package.json` | Defines the `npm start` command |
| `src/kipco-loader.js` | The animation. All timings are in `TIMELINE` at the top |
| `src/kipco-loader.css` | Layout and colours (`--kl-*` tokens) |
| `assets/kipco-logo.png` | Official KIPCO logo |
| `LICENSE-Montserrat.txt` | Licence for the Montserrat font embedded in the CSS (keep this file) |

## Use with real loading progress

```html
<kipco-loader manual></kipco-loader>
<script>
  const loader = document.querySelector('kipco-loader');
  loader.setProgress(0.4);   // 0..1
  loader.complete();         // when your app is ready
  loader.addEventListener('kipco:ready', () => loader.dismiss());
</script>
```

Without `manual`, the bar fills automatically.
