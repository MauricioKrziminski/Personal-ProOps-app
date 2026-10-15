const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const raiz = __dirname;
const kt = (nome) => fs.readFileSync(path.join(raiz, 'android/src/main/java/expo/modules/proopscaptura', nome), 'utf8');

test('registra o módulo só no Android', () => {
  const config = JSON.parse(fs.readFileSync(path.join(raiz, 'expo-module.config.json'), 'utf8'));
  assert.deepEqual(config.platforms, ['android']);
  assert.deepEqual(config.android.modules, ['expo.modules.proopscaptura.ProOpsCapturaModule']);
});

test('declara o listener protegido pela permissão do sistema', () => {
  const manifesto = fs.readFileSync(path.join(raiz, 'android/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifesto, /android:name="expo\.modules\.proopscaptura\.CapturaService"/);
  assert.match(manifesto, /android:permission="android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE"/);
  assert.match(manifesto, /android\.service\.notification\.NotificationListenerService/);
});

test('o serviço filtra por pacote escolhido e só grava com a captura ligada', () => {
  const fonte = kt('Captura.kt');
  assert.match(fonte, /if \(!ativa\(ctx\) \|\| sbn\.packageName !in pacotes\(ctx\)\) return/);
  assert.match(fonte, /FLAG_GROUP_SUMMARY/);
  assert.match(fonte, /MAX_PENDENTES/);
  assert.match(fonte, /300_000/); // janela de 5 min no id
});

test('o serviço não fala com a rede', () => {
  for (const nome of ['Captura.kt', 'CapturaService.kt', 'ProOpsCapturaModule.kt']) {
    assert.doesNotMatch(kt(nome), /HttpURLConnection|OkHttp|java\.net\.URL|WorkManager/);
  }
});

test('expõe as funções que o app usa', () => {
  const fonte = kt('ProOpsCapturaModule.kt');
  for (const f of ['acessoConcedido', 'abrirAjustes', 'estado', 'configurar', 'pendentes', 'remover']) {
    assert.match(fonte, new RegExp(`Function\\("${f}"\\)`));
  }
});

test('configurar é sincronizado e limpa da fila o que saiu da seleção', () => {
  const fonte = kt('Captura.kt');
  assert.match(fonte, /@Synchronized\s+fun configurar/);
  assert.match(fonte, /filter \{ it\.optString\("package"\) in novos \}/);
});

test('a fila não perde dado: corrompido é preservado, E/S não sobrescreve, fsync antes do rename', () => {
  const fonte = kt('Captura.kt');
  assert.match(fonte, /catch \(e: JSONException\)[\s\S]{0,80}preservarCorrompido/);
  assert.match(fonte, /\$ARQUIVO\.corrompido/);
  // erro de E/S na leitura devolve null (quem chama não escreve por cima) e a gravação nunca derruba o serviço
  assert.match(fonte, /catch \(e: IOException\)[\s\S]{0,120}return null/);
  assert.match(fonte, /val atuais = ler\(ctx\) \?: return/);
  assert.match(fonte, /FileOutputStream\(tmp\)\.use/);
  assert.ok(fonte.indexOf('fd.sync()') > 0 && fonte.indexOf('fd.sync()') < fonte.indexOf('renameTo(arquivo(ctx))'));
  assert.match(fonte, /if \(!tmp\.renameTo\(arquivo\(ctx\)\)\) throw IOException/);
  assert.doesNotMatch(fonte, /catch \(e: Exception\) \{\s*emptyList\(\)/);
});

test('a fila tem DONO: gravado em cada item e na configuração, e o configurar descarta o de outro dono', () => {
  const fonte = kt('Captura.kt');
  assert.match(fonte, /fun configurar\(ctx: Context, ativa: Boolean, pacotes: List<String>, dono: String\?\)/);
  assert.match(fonte, /dono\(ctx\)\?\.let \{ nova\.put\("dono", it\) \}/);
  assert.match(fonte, /it\.optString\("dono"\)\.isBlank\(\) \|\| it\.optString\("dono"\) == novoDono/);
  // item sem dono (versão anterior) fica e vira do dono atual
  assert.match(fonte, /onEach \{ if \(novoDono != null && it\.optString\("dono"\)\.isBlank\(\)\) it\.put\("dono", novoDono\) \}/);
  const modulo = kt('ProOpsCapturaModule.kt');
  assert.match(modulo, /Function\("configurar"\) \{ ativa: Boolean, pacotes: List<String>, dono: String\? ->/);
  assert.match(modulo, /"dono" to it\.optString\("dono"\)/);
  assert.match(modulo, /"dono" to Captura\.dono\(ctx\)/); // estado() expõe o dono: o JS desliga a captura de outra conta
});
