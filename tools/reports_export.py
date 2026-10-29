#!/usr/bin/env python3
"""Collect the "Mistake report" issues into one JSON file, for patching the dictionary.

    python3 tools/reports_export.py [out.json]      (default: dev/reports.json)

Needs the GitHub CLI (`gh`), logged in. Each issue made from the form
.github/ISSUE_TEMPLATE/mistake-report.yml has its fields under "### Label" headings;
this reads them back into {number, state, created, kind, word, changed, expected, why, context,
page, note, info}. Issues closed as handled stay in (state "closed"), so a patch can tell
what was already dealt with.
"""
import json, re, subprocess, sys

FIELDS = {'Kind': 'kind', 'Word or phrase': 'word', 'What the extension changed it to': 'changed',
          'What it should be': 'expected', 'Why it changed (from the hover card)': 'why',
          'Sentence around it': 'context', 'Page': 'page', 'Note': 'note', 'Version and settings': 'info'}

def parse(body):
    out = dict.fromkeys(FIELDS.values(), '')
    for label, value in re.findall(r'^### (.+?)\s*\n\n?(.*?)(?=^### |\Z)', body or '', re.M | re.S):
        key = FIELDS.get(label.strip())
        value = value.strip()
        if key and value != '_No response_':
            out[key] = value
    return out

def main(path):
    raw = subprocess.run(['gh', 'issue', 'list', '-R', 'AuroraNoUnderscores/hochdeutsch-fixer', '--label', 'mistake-report',
                          '--state', 'all', '--limit', '5000', '--json', 'number,state,createdAt,body'],
                         check=True, capture_output=True, text=True).stdout
    reports = [{'number': i['number'], 'state': i['state'].lower(), 'created': i['createdAt'], **parse(i['body'])}
               for i in sorted(json.loads(raw), key=lambda i: i['number'])]
    reports = [r for r in reports if r['word']]
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(reports, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'{len(reports)} reports -> {path}')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'dev/reports.json')
