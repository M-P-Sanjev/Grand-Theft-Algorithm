"""Risk classifier fixtures for emergency dispatch."""

from backend.orchestration.crisis.severity import classify_severity


def test_bat_assault_is_critical():
    case = {
        'notes': 'My husband hit me with a bat.',
        'frequency': 'once',
        'previous_report_count': 0,
    }
    result = classify_severity(case, message=case['notes'])
    assert result['risk_index'] >= 90
    assert result['tier'] == 'CRITICAL'
    assert result['severity'] == 'critical'
    reasons = ' '.join(result.get('reasons') or []).lower()
    assert 'weapon' in reasons or 'assault' in reasons


def test_low_signal_stays_low_or_medium():
    case = {
        'notes': 'I felt sad today and want to talk.',
        'frequency': 'once',
    }
    result = classify_severity(case, message=case['notes'])
    assert result['risk_index'] < 75
    assert result['tier'] in ('LOW', 'MEDIUM')
