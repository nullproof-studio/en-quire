# Deployment Procedures

Overview of deployment procedures.

## 1. Pre-deployment

Steps before deployment.

### 1.1 Environment Check

Verify environment variables are set.

### 1.2 Dependencies

Run dependency audit.

## 2. Deployment Steps

The actual deployment process.

### 2.1 Build

Build the application.

### 2.2 Deploy

Push to production.

#### 2.2.1 Staging

Deploy to staging first.

#### 2.2.2 Production
Deploy to production after staging passes.

**New requirement (March 2026):** All production deployments require approval from the en-quire governance layer before proceeding. Use `mode: propose` for the deployment manifest.
### 2.3 Verify

Run smoke tests.

## 3. Post-deployment

After deployment tasks.

### 3.1 Monitoring

Check dashboards.

### 3.2 Rollback Plan

Steps to rollback if needed.
