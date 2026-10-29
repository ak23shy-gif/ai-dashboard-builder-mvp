# Extract deployment ownership

The extractor frontend belongs at https://google-api-data-extractor.vercel.app.
Its backend belongs at https://google-api-data-extractor-backend.onrender.com.

The root homepage (`app/page.tsx`) must render `ExtractionApp`. Vercel's
repository build command checks this before building. Do not replace it with
the legacy dashboard builder or remove the check to deploy another product.

Other software must have its own source repository (or a separately configured
root directory), Vercel project, production domain, and deployment configuration.
Do not deploy another checkout to the extractor Vercel project or move its domain.
Do not reuse a `.vercel/project.json` link from another project.

The build checks both the homepage and VERCEL_PROJECT_PRODUCTION_URL. This source
only builds on Vercel when that system variable equals
google-api-data-extractor.vercel.app. The ignore command skips other projects;
the build command independently refuses them if the skip check is bypassed.
Keep Vercel's automatic system environment variables enabled. A missing identity
fails closed rather than risking a deployment to the wrong project.

DashForge's saved code is in the private ak23shy-gif/dashforge-ai repository,
on main. Its Vercel Git connection has NOT yet been changed from the shared repo.
Until it is relinked, pushes here will skip DashForge rather than update it.
These guards do not restore a previously incorrect live deployment or change
Vercel's Git connection. The live project's settings and domains
must be verified before claiming complete repository isolation.
Keep the existing deployment live while changing those settings; validate a
preview from the intended source before promoting a replacement.

Backend environment variables and Google OAuth callbacks must continue to use
the extractor's domains. Do not copy another application's configuration into
the extractor's Vercel or Render settings.
