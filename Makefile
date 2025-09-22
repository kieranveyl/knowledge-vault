# Knowledge Repository Database Management
# Simple commands to manage PostgreSQL database

.PHONY: help db-start db-stop db-status db-logs db-migrate db-wipe db-reset db-clean db-shell

# Default target
help:
	@echo ""
	@echo "🗄️  Knowledge Repository Database Management"
	@echo "============================================="
	@echo ""
	@echo "Database Operations:"
	@echo "  make db-start    - Start PostgreSQL database"
	@echo "  make db-stop     - Stop PostgreSQL database"
	@echo "  make db-status   - Check database status"
	@echo "  make db-logs     - Show database logs"
	@echo ""
	@echo "Schema Management:"
	@echo "  make db-migrate  - Apply database migrations"
	@echo "  make db-wipe     - Wipe all data (keep schema)"
	@echo "  make db-reset    - Complete reset (schema + data)"
	@echo "  make db-clean    - Stop and remove everything"
	@echo ""
	@echo "Development:"
	@echo "  make db-shell    - Open PostgreSQL shell"
	@echo "  make demo        - Run complete demo workflow"
	@echo ""

# Start the database
db-start:
	@echo "🚀 Starting PostgreSQL database..."
	docker-compose up -d postgres
	@echo "⏳ Waiting for database to be ready..."
	@sleep 3
	@make db-status

# Stop the database
db-stop:
	@echo "🛑 Stopping PostgreSQL database..."
	docker-compose stop postgres

# Check database status
db-status:
	@echo "📊 Database Status:"
	@docker-compose ps postgres
	@echo ""
	@echo "🔍 Connection Test:"
	@if docker exec knowledge-repository-postgres-1 pg_isready -U postgres -d knowledge >/dev/null 2>&1; then \
		echo "✅ Database is ready and accepting connections"; \
		echo "📈 Database Info:"; \
		docker exec knowledge-repository-postgres-1 psql -U postgres -d knowledge -c "SELECT version();" -t | head -1; \
		echo "📋 Tables:"; \
		docker exec knowledge-repository-postgres-1 psql -U postgres -d knowledge -c "SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = 'public';" -t | xargs echo "   Tables:"; \
	else \
		echo "❌ Database is not ready"; \
	fi

# Show database logs
db-logs:
	@echo "📋 Database Logs (last 50 lines):"
	docker-compose logs --tail=50 postgres

# Apply migrations
db-migrate:
	@echo "🔧 Applying database migrations..."
	@make db-start
	bun scripts/migrate.ts
	@echo "✅ Migrations applied successfully"

# Wipe all data but keep schema
db-wipe:
	@echo "⚠️  Wiping all data (keeping schema)..."
	@read -p "Are you sure? This will delete ALL data but keep tables [y/N]: " confirm && [ "$$confirm" = "y" ] || exit 1
	@echo "🧹 Clearing all table data..."
	docker exec knowledge-repository-postgres-1 psql -U postgres -d knowledge -c "\
		TRUNCATE TABLE collection_memberships CASCADE; \
		TRUNCATE TABLE publication_collections CASCADE; \
		TRUNCATE TABLE citations CASCADE; \
		TRUNCATE TABLE answers CASCADE; \
		TRUNCATE TABLE queries CASCADE; \
		TRUNCATE TABLE sessions CASCADE; \
		TRUNCATE TABLE corpus_versions CASCADE; \
		TRUNCATE TABLE search_index CASCADE; \
		TRUNCATE TABLE corpus CASCADE; \
		TRUNCATE TABLE passages CASCADE; \
		TRUNCATE TABLE publications CASCADE; \
		TRUNCATE TABLE versions CASCADE; \
		TRUNCATE TABLE drafts CASCADE; \
		TRUNCATE TABLE notes CASCADE; \
		TRUNCATE TABLE collections CASCADE; \
		TRUNCATE TABLE snapshots CASCADE; \
		TRUNCATE TABLE events CASCADE; \
		DELETE FROM schema_migrations WHERE name != '001_initial_schema'; \
	"
	@echo "✅ All data wiped, schema preserved"

# Complete reset - remove everything and recreate
db-reset:
	@echo "💥 Complete database reset (schema + data)..."
	@read -p "Are you sure? This will destroy EVERYTHING [y/N]: " confirm && [ "$$confirm" = "y" ] || exit 1
	@echo "🛑 Stopping database..."
	docker-compose down postgres
	@echo "🗑️  Removing database volume..."
	docker volume rm knowledge-repository_postgres_data 2>/dev/null || true
	@echo "🚀 Starting fresh database..."
	docker-compose up -d postgres
	@sleep 5
	@echo "🔧 Applying fresh migrations..."
	bun scripts/migrate.ts
	@echo "✅ Database completely reset and ready"

# Stop and remove everything (containers, volumes, networks)
db-clean:
	@echo "🧹 Cleaning up all database resources..."
	@read -p "Are you sure? This removes containers and volumes [y/N]: " confirm && [ "$$confirm" = "y" ] || exit 1
	docker-compose down -v
	docker volume rm knowledge-repository_postgres_data 2>/dev/null || true
	@echo "✅ All database resources cleaned"

# Open PostgreSQL shell
db-shell:
	@echo "🐚 Opening PostgreSQL shell..."
	@echo "💡 Tip: Use \\dt to list tables, \\q to quit"
	docker exec -it knowledge-repository-postgres-1 psql -U postgres -d knowledge

# Quick development setup
db-dev-setup: db-reset
	@echo "🏗️  Setting up development environment..."
	bun scripts/manage-collections.ts
	bun scripts/create-draft.ts
	@echo "✅ Development environment ready with sample data"

# Run complete demo
demo: db-start
	@echo "🌟 Running complete demo workflow..."
	bun scripts/demo-workflow.ts

# Database info and health check
db-info:
	@echo "📊 Database Information:"
	@echo "========================"
	@make db-status
	@echo ""
	@echo "📋 Schema Information:"
	docker exec knowledge-repository-postgres-1 psql -U postgres -d knowledge -c "\
		SELECT schemaname, tablename, tableowner \
		FROM pg_tables \
		WHERE schemaname = 'public' \
		ORDER BY tablename;" 2>/dev/null || echo "❌ Could not retrieve schema info"
	@echo ""
	@echo "💾 Data Counts:"
	@docker exec knowledge-repository-postgres-1 psql -U postgres -d knowledge -c "\
		SELECT \
			(SELECT COUNT(*) FROM collections) as collections, \
			(SELECT COUNT(*) FROM notes) as notes, \
			(SELECT COUNT(*) FROM drafts) as drafts, \
			(SELECT COUNT(*) FROM versions) as versions, \
			(SELECT COUNT(*) FROM publications) as publications;" 2>/dev/null || echo "❌ Could not retrieve data counts"

# Backup database to SQL file
db-backup:
	@echo "💾 Creating database backup..."
	@mkdir -p backups
	@BACKUP_FILE="backups/backup_$(shell date +%Y%m%d_%H%M%S).sql" && \
	docker exec knowledge-repository-postgres-1 pg_dump -U postgres -d knowledge > "$$BACKUP_FILE" && \
	echo "✅ Backup created: $$BACKUP_FILE"

# Restore database from SQL file
db-restore:
	@echo "📥 Restoring database from backup..."
	@echo "Available backups:"
	@ls -la backups/*.sql 2>/dev/null || echo "No backups found"
	@read -p "Enter backup filename (from backups/): " filename && \
	if [ -f "backups/$$filename" ]; then \
		make db-reset && \
		docker exec -i knowledge-repository-postgres-1 psql -U postgres -d knowledge < "backups/$$filename" && \
		echo "✅ Database restored from $$filename"; \
	else \
		echo "❌ Backup file not found"; \
	fi
