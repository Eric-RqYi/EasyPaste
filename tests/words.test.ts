import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertRules } from '../src/rules';
import { DEFAULT_SETTINGS } from '../src/settings';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const options = () => ({ ...DEFAULT_SETTINGS.rules, lists: false, vocabulary: '', replacements: '' });
const clean = (input: string) => convertRules(input, options()).text;

test('built-in US/GB dictionaries repair words and inflections without custom data', () => {
  assert.equal(clean('encyclo-\npedia transfor-\nmations organi-\nsations behav-\niours'),
    'encyclopedia transformations organisations behaviours');
  assert.equal(clean('encyclo-pedia'), 'encyclopedia');
  assert.equal(clean('infor\u00AD\nmation'), 'information');
});

test('real hyphens survive line joining and ambiguous spellings remain unchanged', () => {
  assert.equal(clean('well-\nknown machine-\nlearning state-of-the-\nart'),
    'well-known machine-learning state-of-the-art');
  const ambiguous = 're-creation re-\ncreation some-\nthing the-\nrapist co-operate';
  assert.equal(clean(ambiguous), ambiguous);
  assert.equal(clean('unrecognisedfragment-\nanotherfragment'), 'unrecognisedfragment-\nanotherfragment');
});

test('frequency-ranked splits work without replacement tables, including short words', () => {
  assert.equal(clean('neuralnetwork languageprocessing ofthe readthis Iam Ihave'),
    'neural network language processing of the read this I am I have');
  assert.equal(clean('Neuralnetwork unknownword'), 'Neural network unknown word');
  assert.equal(clean('thequickbrownfox'), 'thequickbrownfox'); // More than two words is deliberately deferred.
});

test('frequency distinguishes strong candidates and abstains when alternatives tie', () => {
  const opts = options();
  opts.vocabulary = 'theo ther';
  assert.equal(convertRules('theother', opts).text, 'the other');
  opts.vocabulary = 'zorb fleen zorbf leen';
  assert.equal(convertRules('zorbfleen', opts).text, 'zorbfleen');
});

test('valid words, spelling errors, acronyms and mixed-case names are preserved', () => {
  const input = 'another therapist nowhere into notebook database recreation unionized colour behaviour OpenAI NeuralNetwork NEURALNETWORK tehword';
  assert.equal(clean(input), input);
});

test('user vocabulary is additive, protects complete terms and invalidates cached splits', () => {
  const opts = options();
  assert.equal(convertRules('neuralnetwork', opts).text, 'neural network');
  opts.vocabulary = 'neuralnetwork';
  assert.equal(convertRules('neuralnetwork encyclo-\npedia', opts).text, 'neuralnetwork encyclopedia');
  opts.replacements = 'neuralnetwork => neural network\nanother => an other';
  assert.equal(convertRules('Neuralnetwork ANOTHER', opts).text, 'Neural network AN OTHER');
  opts.vocabulary = ''; opts.replacements = '';
  assert.equal(convertRules('neuralnetwork', opts).text, 'neural network');
  opts.vocabulary = 'zorbfleen';
  assert.equal(convertRules('zorb-\nfleen', opts).text, 'zorbfleen');
  assert.equal(clean('zorb-\nfleen'), 'zorb-\nfleen'); // No leak into the shared dictionary.
});

test('identifiers, possessives, contractions and long tokens are not partially split', () => {
  const long = 'z'.repeat(65) + 'neuralnetwork';
  const input = `my_neuralnetwork neuralnetwork2 neuralnetwork-based neuralnetwork's neuralnetwork’s don'tread 中文neuralnetwork ${long}`;
  assert.equal(clean(input), input);
  assert.equal(clean("'neuralnetwork' ‘readthis’"), "'neural network' ‘read this’");
});

test('new repairs respect Markdown protection and preserve CRLF and letter sequences', () => {
  const protectedInput = '---\nterm: neuralnetwork\n---\n```text\nencyclo-\npedia\n```\n`readthis` $neuralnetwork$ [readthis](https://example.com) ![[neuralnetwork]]';
  assert.equal(clean(protectedInput), protectedInput);
  assert.equal(clean('encyclo-\r\npedia\r\nneuralnetwork'), 'encyclopedia\r\nneural network');
  const words = 'Neuralnetwork ofthe readthis Iam unknownword';
  const result = clean(words);
  assert.equal(result.replace(/ /g, ''), words.replace(/ /g, ''));
  assert.equal(clean(result), result);
});

test('word repairs remain independently switchable', () => {
  const opts = options(); opts.words = false;
  const input = 'encyclo-\npedia neuralnetwork ofthe';
  assert.deepEqual(convertRules(input, opts), { text: input, reasons: [] });
});

test('browser bundle runs offline without Node globals or dictionary file access', async () => {
  const bundled = await build({
    entryPoints: ['src/words.ts'], bundle: true, platform: 'browser', target: 'es2022',
    format: 'iife', globalName: 'WordCleanup', write: false
  });
  const context = {
    fetch: () => { throw new Error('Word cleanup must not access the network'); }
  };
  runInNewContext(bundled.outputFiles[0].text, context);
  assert.equal(runInNewContext("WordCleanup.wordRepair('').split('neuralnetwork')", context), 'neural network');
  assert.equal(runInNewContext("WordCleanup.wordRepair('').hyphen('organi', 'sations', true)", context), 'organisations');
});
