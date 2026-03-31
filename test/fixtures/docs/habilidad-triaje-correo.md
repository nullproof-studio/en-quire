# Habilidad: Triaje de Correo Electrónico

**Propósito:** Instrucciones para clasificar y enrutar correos entrantes de clientes hacia los flujos de trabajo apropiados.

---

## Cuándo Usar Esta Habilidad

Activar cuando se recibe un correo electrónico de un cliente que:
- Describe un incidente, pérdida, daño o robo
- Solicita información sobre el estado de una reclamación
- Contiene lenguaje relacionado con siniestros ("mi coche fue golpeado", "hubo una inundación", "necesito hacer una reclamación")
- Es una correspondencia reenviada por otro agente para triaje

## Flujo de Trabajo Principal

### Paso 1: Identificación del Cliente

Buscar al cliente por nombre, correo electrónico o referencia. Si no se encuentra, crear un registro nuevo con los datos disponibles del correo.

### Paso 2: Clasificación del Correo

Determinar la categoría:
- **Nuevo siniestro** — primera notificación de pérdida (FNOL)
- **Seguimiento** — actualización sobre una reclamación existente
- **Consulta general** — pregunta sobre póliza, cobertura o procedimiento
- **Queja** — insatisfacción con el servicio o la resolución


- **Duplicado** — el cliente reporta el mismo incidente más de una vez. Vincular a la reclamación existente.

### Paso 3: Enrutamiento

| Categoría | Acción | Agente Destino |
|-----------|--------|----------------|
| Nuevo siniestro | Crear reclamación, solicitar documentación | Michelle |
| Seguimiento | Actualizar reclamación existente | Michelle |
| Consulta general | Responder directamente o escalar | Minnie |
| Queja | Escalar inmediatamente con contexto completo | Andy |

### Paso 4: Confirmación

Enviar acuse de recibo al cliente en su idioma preferido. Incluir:
- Número de referencia (si aplica)
- Próximos pasos esperados
- Tiempo estimado de respuesta

## Errores Comunes a Evitar

- **No clasificar sin leer el correo completo.** El asunto puede ser engañoso.
- **No asumir el idioma del cliente.** Verificar el idioma del correo y responder en el mismo.
- **No cerrar sin confirmar.** Siempre verificar que la acción se ejecutó correctamente antes de marcar como completado.

## Herramientas Disponibles

- `comms-InboxGet` — obtener contenido completo del correo
- `customer_ro-search` — buscar cliente por nombre o email
- `Sparqiva_CreateClaim` — abrir nueva reclamación
- `Sparqiva_UpdateClaim` — actualizar reclamación existente
- `comms-Send` — enviar respuesta al cliente
