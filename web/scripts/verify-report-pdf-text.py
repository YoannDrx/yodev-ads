"""Inspect fixtures created by verify-report-rendering.ts. Requires pdfplumber."""
import json
import re
from pathlib import Path
import pdfplumber

root = Path(__file__).resolve().parent.parent / 'tmp/pdfs/report-rendering'
expected = json.loads((root / 'expected.json').read_text())
compact = lambda value: re.sub(r'\s+', '', value)
results = []
for locale in ('fr', 'en'):
    with pdfplumber.open(root / f'report-{locale}.pdf') as document:
        text = '\n'.join(page.extract_text() or '' for page in document.pages)
        # Exclude the repeated brand/client/date header and the edition/page footer.
        body = '\n'.join(page.crop((39, 175, 556, 774)).extract_text() or '' for page in document.pages)
        for field in ('editorialComment', 'actionPlan'):
            assert len(expected[field]) == 5000
            assert compact(expected[field]) in compact(body), f'{locale}: incomplete {field}'
        for prefix, count, digits in [('COMMENT', expected['commentTokens'], 4), ('ACTION', expected['actionTokens'], 4), ('CAMPAIGN', expected['campaigns'], 3)]:
            for index in range(count):
                assert f'{prefix}_{index:0{digits}}' in text, f'{locale}: missing {prefix} {index}'
        for marker in expected['missing'] + ['Ελληνικά', 'Кириллица', '2026-08-01', '2026-08-31']:
            assert marker in text, f'{locale}: missing {marker}'
        assert ('Powered by Ads by Yodev' in text) == (locale == 'fr')
        for page in document.pages:
            assert page.width == 595 and page.height == 842
            for word in page.extract_words():
                assert 39 <= word['x0'] <= word['x1'] <= 556, f'{locale}: horizontal overflow {word}'
                assert 8 <= word['top'] <= word['bottom'] <= 820, f'{locale}: vertical overflow {word}'
        (root / f'report-{locale}.txt').write_text(text)
        results.append({'locale': locale, 'pages': len(document.pages), 'campaigns': expected['campaigns'], 'editorialCharacters': 5000, 'actionPlanCharacters': 5000, 'textAndMargins': 'pass'})
print(json.dumps({'ok': True, 'results': results}))
