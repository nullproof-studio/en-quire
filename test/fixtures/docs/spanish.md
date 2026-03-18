# Guía de Operaciones

Documentación operativa para el equipo de ingeniería.

## 1. Gestión de Incidentes

Procedimientos para la gestión de incidentes en producción.

### 1.1 Clasificación

Clasifique el incidente según su gravedad:

- **Crítico:** Servicio completamente inaccesible
- **Alto:** Funcionalidad principal degradada
- **Medio:** Funcionalidad secundaria afectada
- **Bajo:** Problema cosmético o menor

### 1.2 Escalación

Si el incidente no se resuelve en 30 minutos, escale al equipo de guardia.

## 2. Procedimientos Estándar

### 2.1 Despliegue

Pasos para realizar un despliegue seguro:

1. Verificar que todas las pruebas pasen
2. Crear una rama de liberación
3. Desplegar en el entorno de pruebas
4. Ejecutar pruebas de humo
5. Desplegar en producción

### 2.2 Monitorización

Revise los paneles de control cada mañana:

| Panel | URL | Responsable |
|-------|-----|-------------|
| Métricas API | grafana.internal/api | Equipo Backend |
| Errores | sentry.internal | Equipo de Guardia |
| Infraestructura | grafana.internal/infra | Equipo SRE |

## 3. Contactos

### 3.1 Equipo de Guardia

Consulte el calendario de rotación en PagerDuty.

### 3.2 Proveedores Externos

Para problemas con servicios de terceros, consulte la lista de contactos en el wiki interno.

> **Nota:** Mantenga esta documentación actualizada. La información desactualizada es peor que ninguna información.
