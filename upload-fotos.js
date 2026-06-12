const fs = require('fs');
const path = require('path');

const DESKTOP_FOLDER = path.join(require('os').homedir(), 'Desktop', 'Fotos-Cheka mi cuaderno');
const BASE_URL = 'https://chekamicuaderno.up.railway.app';

let cookie = '';

async function login() {
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=admin',
    redirect: 'manual'
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    cookie = setCookie.split(';')[0];
  }
}

async function uploadFiles(course, week, filePaths) {
  const form = new FormData();
  form.append('course', course);
  form.append('week', String(week));
  for (const fp of filePaths) {
    const buffer = fs.readFileSync(fp);
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    form.append('photos', blob, path.basename(fp));
  }

  const res = await fetch(`${BASE_URL}/admin/upload`, {
    method: 'POST',
    headers: { 'Cookie': cookie },
    body: form,
    redirect: 'manual'
  });

  if (res.status === 302 || res.status === 200) {
    console.log(`    OK (${filePaths.length} foto${filePaths.length > 1 ? 's' : ''})`);
  } else {
    const text = await res.text();
    console.log(`    ERROR ${res.status}: ${text.slice(0, 100)}`);
  }
}

async function main() {
  console.log('Iniciando sesión como admin...');
  await login();
  if (!cookie) {
    console.error('Error: No se pudo iniciar sesión');
    process.exit(1);
  }
  console.log('Sesión iniciada correctamente\n');

  const courseDirs = fs.readdirSync(DESKTOP_FOLDER, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const courseDir of courseDirs) {
    const courseName = courseDir.name.toLowerCase();
    const coursePath = path.join(DESKTOP_FOLDER, courseDir.name);
    const weekDirs = fs.readdirSync(coursePath, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const weekDir of weekDirs) {
      const weekNum = parseInt(weekDir.name.replace('Semana-', ''), 10);
      if (isNaN(weekNum)) continue;

      const weekPath = path.join(coursePath, weekDir.name);
      const files = fs.readdirSync(weekPath)
        .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
        .map(f => path.join(weekPath, f));

      if (files.length === 0) continue;

      console.log(`Subiendo ${courseName} - Semana ${weekNum}...`);
      await uploadFiles(courseName, weekNum, files);
    }
  }

  console.log('\n¡Subida completada!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
