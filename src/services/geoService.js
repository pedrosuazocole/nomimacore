// =====================================================================
// geoService.js
// Calcula la distancia real (en metros) entre dos coordenadas GPS
// usando la formula de Haversine — la formula estandar para distancia
// entre dos puntos sobre la superficie de la Tierra (considera la
// curvatura, no es una simple resta de coordenadas).
// =====================================================================

const RADIO_TIERRA_METROS = 6371000;

function aRadianes(grados) {
    return grados * (Math.PI / 180);
}

/**
 * Distancia en metros entre dos puntos (lat1,lng1) y (lat2,lng2).
 * Si falta cualquiera de las 4 coordenadas, devuelve null (no se puede
 * calcular — ej. la empresa todavia no tiene ubicacion configurada).
 */
function distanciaMetros(lat1, lng1, lat2, lng2) {
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;

    const dLat = aRadianes(lat2 - lat1);
    const dLng = aRadianes(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(aRadianes(lat1)) * Math.cos(aRadianes(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(RADIO_TIERRA_METROS * c);
}

/**
 * Evalua si una distancia esta dentro del radio permitido. Devuelve
 * null si no hay suficiente informacion para evaluar (sin coordenadas
 * de la marca, o sin ubicacion configurada en la empresa).
 */
function dentroDelRango(distanciaMetros, radioPermitido) {
    if (distanciaMetros == null || radioPermitido == null) return null;
    return distanciaMetros <= radioPermitido;
}

module.exports = { distanciaMetros, dentroDelRango };
