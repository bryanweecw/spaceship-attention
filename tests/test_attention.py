"""Real-model checks. Run after setup-local.sh; no cloud APIs or mocked inference."""
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / 'models/qwen2.5-0.5b-instruct-q4_k_m.gguf'
PROMPT = ('The spaceship carried two things: a greenhouse full of roses and a damaged engine. '
          'Mira loved the garden, but the mechanic worried about the reactor. '
          'When she opened the hatch, she found')


class AttentionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.log = open(ROOT / '.capture-local/runner-test.log', 'w')
        cls.runner = subprocess.Popen([str(ROOT / 'build/attention-runner'), str(MODEL)],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=cls.log, text=True)
        assert json.loads(cls.runner.stdout.readline())['ready']

    @classmethod
    def tearDownClass(cls):
        cls.runner.stdin.close()
        cls.runner.wait(timeout=15)
        cls.runner.stdout.close()
        cls.log.close()

    def call(self, **request):
        self.runner.stdin.write(json.dumps(request) + '\n')
        self.runner.stdin.flush()
        result = json.loads(self.runner.stdout.readline())
        self.assertNotIn('error', result)
        return result

    def init(self, prompt=PROMPT):
        return self.call(op='init', prompt=prompt)

    def step(self, bias=None):
        return self.call(op='step', bias=bias or [])

    def test_bias_changes_distribution_with_identical_prompt(self):
        initial = self.init()
        positions = [t['position'] for t in initial['tokens'] if any(w in t['text'] for w in ('rose', 'garden', 'green', 'house'))]
        self.assertTrue(positions)
        baseline = self.step()
        self.init()
        neutral = self.step([{'position': p, 'value': 0} for p in positions])
        self.assertEqual(baseline['top'], neutral['top'])
        self.init()
        positive = self.step([{'position': p, 'value': 3} for p in positions])
        self.assertNotEqual(baseline['top'], positive['top'])
        self.init()
        negative = self.step([{'position': p, 'value': -3} for p in positions])
        self.assertNotEqual(positive['top'], negative['top'])
        self.init()
        self.assertEqual(baseline['top'], self.step()['top'])
        evidence = {'model': MODEL.name, 'prompt': PROMPT, 'positions': positions,
                    'neutral_equals_baseline': True, 'reset_restores_baseline': True,
                    'baseline': baseline, 'positive_bias_3': positive, 'negative_bias_3': negative}
        (ROOT / 'evidence/attention-check.json').write_text(json.dumps(evidence, indent=2) + '\n')

    def test_switch_bias_mid_generation_preserves_prefix(self):
        initial = self.init()
        baseline = [self.step() for _ in range(5)]
        self.init()
        same_prefix = [self.step() for _ in range(4)]
        self.assertEqual(baseline[:4], same_prefix)
        changed = self.step([{'position': initial['tokens'][6]['position'], 'value': 4}])
        self.assertEqual(changed['position'], baseline[4]['position'])
        self.assertNotEqual(changed['top'], baseline[4]['top'])
        cleared = self.step()
        self.assertEqual(cleared['bias'], [])
        self.assertEqual(cleared['position'], changed['position'] + 1)

    def test_unicode_byte_offsets_and_duplicate_words(self):
        text = 'A café on Mars. A café with roses. The visitor saw'
        initial = self.init(text)
        data = text.encode()
        self.assertEqual(initial['tokens'][0]['start'], 0)
        self.assertEqual(initial['tokens'][-1]['end'], len(data))
        for left, right in zip(initial['tokens'], initial['tokens'][1:]):
            self.assertEqual(left['end'], right['start'])
        # Position-based addressing distinguishes repeated words.
        cafes = [t['position'] for t in initial['tokens'] if 'caf' in t['text']]
        self.assertEqual(len(cafes), 2)
        self.step([{'position': cafes[1], 'value': 2}])

    def test_reject_out_of_range_and_nonfinite_bias(self):
        initial = self.init()
        for bias in ([{'position': -1, 'value': 2}],
                     [{'position': initial['prompt_tokens'], 'value': 2}],
                     [{'position': 0, 'value': 99}]):
            self.runner.stdin.write(json.dumps({'op': 'step', 'bias': bias}) + '\n')
            self.runner.stdin.flush()
            self.assertIn('error', json.loads(self.runner.stdout.readline()))
        self.step()


if __name__ == '__main__':
    (ROOT / '.capture-local').mkdir(exist_ok=True)
    unittest.main()
