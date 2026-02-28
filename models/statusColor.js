const BOOTSTRAP_STATUS_COLORS = {
  primary: '#0d6efd',
  secondary: '#6c757d',
  success: '#198754',
  danger: '#dc3545',
  warning: '#ffc107',
  info: '#0dcaf0',
  dark: '#212529',
  light: '#f8f9fa',
};

function resolveStatusColor(value, fallbackKey = 'secondary') {
  const raw = String(value || '').trim().toLowerCase();
  const fallbackHex = BOOTSTRAP_STATUS_COLORS[fallbackKey] || BOOTSTRAP_STATUS_COLORS.secondary;

  if (BOOTSTRAP_STATUS_COLORS[raw]) {
    return {
      key: raw,
      hex: BOOTSTRAP_STATUS_COLORS[raw],
      textColor: raw === 'warning' || raw === 'info' || raw === 'light' ? '#212529' : '#ffffff',
    };
  }

  if (/^#[0-9a-f]{6}$/i.test(raw)) {
    return {
      key: null,
      hex: raw,
      textColor: '#ffffff',
    };
  }

  return {
    key: fallbackKey,
    hex: fallbackHex,
    textColor: fallbackKey === 'warning' || fallbackKey === 'info' || fallbackKey === 'light' ? '#212529' : '#ffffff',
  };
}

function normalizeStatusColorInput(value, fallbackKey = 'secondary') {
  const raw = String(value || '').trim().toLowerCase();
  if (BOOTSTRAP_STATUS_COLORS[raw]) return raw;
  return fallbackKey;
}

module.exports = {
  BOOTSTRAP_STATUS_COLORS,
  resolveStatusColor,
  normalizeStatusColorInput,
};
