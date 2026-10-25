/* ==========================================================================
   CONFIGURACIÓN DEL SALÓN
   Cambia aquí los datos de cada peluquería: horario, teléfono, WhatsApp...
   El horario en tiempo real y el sistema de citas leen de este archivo.
   Servicios y equipo se editan directamente en index.html.
   ========================================================================== */
(function () {
  "use strict";
  window.__BRAND__ = {
    name: "Corteza",
    city: "Madrid",
    timeZone: "Europe/Madrid",          // zona horaria del salón
    phone: "+34 910 000 000",
    whatsapp: "34600000000",            // sin + ni espacios
    email: "hola@corteza.es",
    address: "Calle del Pez 21, 28004 Madrid",

    // Horario semanal. 0 = domingo, 1 = lunes ... 6 = sábado.
    // Cada día: lista de tramos [apertura, cierre]. Vacío = cerrado.
    schedule: {
      0: [],
      1: [],
      2: [["10:00", "14:00"], ["16:00", "20:30"]],
      3: [["10:00", "14:00"], ["16:00", "20:30"]],
      4: [["10:00", "20:30"]],
      5: [["10:00", "20:30"]],
      6: [["09:30", "15:00"]]
    },

    // Días festivos / vacaciones (YYYY-MM-DD): el salón aparece cerrado.
    holidays: ["2026-12-25", "2027-01-01", "2027-01-06"],

    booking: {
      slotStep: 30,        // minutos entre huecos
      daysAhead: 21,       // días que se pueden reservar
      minNotice: 60,       // minutos mínimos de antelación para hoy
      demoBusyRate: 0.22  // % de huecos que aparecen ocupados en la demo
    }
  };
})();
