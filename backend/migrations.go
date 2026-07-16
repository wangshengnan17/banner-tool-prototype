package main

import (
	"log"

	"github.com/pocketbase/pocketbase/core"
)

func ensureCollections(app core.App) error {
	// 确保超级管理员存在
	if err := ensureSuperuser(app); err != nil {
		log.Printf("WARN: ensureSuperuser: %v", err)
	}

	// 先扩展 users collection（display_name、role）
	if err := ensureUsers(app); err != nil {
		return err
	}

	users, _ := app.FindCollectionByNameOrId("users")

	collections := []struct {
		name string
		fn   func(core.App, *core.Collection) error
	}{
		{"projects", ensureProjects},
		{"tasks", ensureTasks},
		{"iterations", ensureIterations},
		{"generation_configs", ensureGenerationConfigs},
		{"generation_results", ensureGenerationResults},
		{"evaluations", ensureEvaluations},
		{"model_configs", ensureModelConfigs},
		{"activity_templates", ensureActivityTemplates},
	}

	for _, col := range collections {
		existing, _ := app.FindCollectionByNameOrId(col.name)
		if existing == nil {
			if err := col.fn(app, users); err != nil {
				return err
			}
		}
	}
	return nil
}

func ensureUsers(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	needsSave := false

	// display_name
	hasDisplayName := false
	for _, f := range users.Fields {
		if f.GetName() == "display_name" {
			hasDisplayName = true
			break
		}
	}
	if !hasDisplayName {
		users.Fields.Add(&core.TextField{Name: "display_name"})
		needsSave = true
	}

	// role
	hasRole := false
	for _, f := range users.Fields {
		if f.GetName() == "role" {
			hasRole = true
			break
		}
	}
	if !hasRole {
		users.Fields.Add(&core.SelectField{
			Name:     "role",
			Values:   []string{"admin", "designer"},
			Required: true,
			MaxSelect: 1,
		})
		needsSave = true
	}

	if needsSave {
		return app.Save(users)
	}
	return nil
}

// ============================================================
// 权限规则
// 登录即可查看/创建；仅 owner 或 admin 可修改/删除
// ============================================================
const ruleLoggedIn = "@request.auth.id != ''"
const ruleOwnerOrAdmin = "@request.auth.id = owner || @request.auth.role = 'admin'"

func ensureProjects(app core.App, users *core.Collection) error {
	collection := core.NewCollection(core.CollectionTypeBase, "projects")
	collection.ListRule = ptr(ruleLoggedIn)
	collection.ViewRule = ptr(ruleLoggedIn)
	collection.CreateRule = ptr(ruleLoggedIn)
	collection.UpdateRule = ptr(ruleOwnerOrAdmin)
	collection.DeleteRule = ptr(ruleOwnerOrAdmin)
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "owner", CollectionId: users.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "name", Required: true},
		&core.TextField{Name: "description"},
		&core.SelectField{Name: "status", Values: []string{"active", "archived"}, Required: true, MaxSelect: 1},
	)
	return app.Save(collection)
}

func ensureTasks(app core.App, users *core.Collection) error {
	projects, _ := app.FindCollectionByNameOrId("projects")
	collection := core.NewCollection(core.CollectionTypeBase, "tasks")
	collection.ListRule = ptr(ruleLoggedIn)
	collection.ViewRule = ptr(ruleLoggedIn)
	collection.CreateRule = ptr(ruleLoggedIn)
	collection.UpdateRule = ptr(ruleOwnerOrAdmin)
	collection.DeleteRule = ptr(ruleOwnerOrAdmin)
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "owner", CollectionId: users.Id, Required: true, MaxSelect: 1},
		&core.RelationField{Name: "project", CollectionId: projects.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "name", Required: true},
		&core.TextField{Name: "description"},
		&core.SelectField{Name: "status", Values: []string{"draft", "in_progress", "completed"}, Required: true, MaxSelect: 1},
	)
	return app.Save(collection)
}

func ensureIterations(app core.App, users *core.Collection) error {
	tasks, _ := app.FindCollectionByNameOrId("tasks")
	collection := core.NewCollection(core.CollectionTypeBase, "iterations")
	collection.ListRule = ptr(ruleLoggedIn)
	collection.ViewRule = ptr(ruleLoggedIn)
	collection.CreateRule = ptr(ruleLoggedIn)
	collection.UpdateRule = ptr(ruleOwnerOrAdmin)
	collection.DeleteRule = ptr(ruleOwnerOrAdmin)
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "owner", CollectionId: users.Id, Required: true, MaxSelect: 1},
		&core.RelationField{Name: "task", CollectionId: tasks.Id, Required: true, MaxSelect: 1},
		&core.NumberField{Name: "version", Required: true},
		&core.SelectField{Name: "status", Values: []string{"draft", "generated", "evaluated", "approved"}, Required: true, MaxSelect: 1},
		&core.BoolField{Name: "is_best"},
		&core.TextField{Name: "notes"},
	)
	return app.Save(collection)
}

func ensureGenerationConfigs(app core.App, users *core.Collection) error {
	iterations, _ := app.FindCollectionByNameOrId("iterations")
	collection := core.NewCollection(core.CollectionTypeBase, "generation_configs")
	collection.ListRule = ptr(ruleLoggedIn)
	collection.ViewRule = ptr(ruleLoggedIn)
	collection.CreateRule = ptr(ruleLoggedIn)
	collection.UpdateRule = ptr(ruleOwnerOrAdmin)
	collection.DeleteRule = ptr(ruleOwnerOrAdmin)
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "owner", CollectionId: users.Id, Required: true, MaxSelect: 1},
		&core.RelationField{Name: "iteration", CollectionId: iterations.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "title"},
		&core.TextField{Name: "subtitle"},
		&core.TextField{Name: "button_text"},
		&core.TextField{Name: "activity_time"},
		&core.TextField{Name: "prompt", Required: true},
		&core.TextField{Name: "image_model", Required: true},
		&core.TextField{Name: "api_mode"},
		&core.FileField{Name: "reference_image", MaxSize: 20 * 1024 * 1024, MaxSelect: 1},
		&core.JSONField{Name: "params_json"},
	)
	return app.Save(collection)
}

func ensureGenerationResults(app core.App, users *core.Collection) error {
	configs, _ := app.FindCollectionByNameOrId("generation_configs")
	iterations, _ := app.FindCollectionByNameOrId("iterations")
	collection := core.NewCollection(core.CollectionTypeBase, "generation_results")
	collection.ListRule = ptr(ruleLoggedIn)
	collection.ViewRule = ptr(ruleLoggedIn)
	collection.CreateRule = ptr(ruleLoggedIn)
	collection.UpdateRule = ptr(ruleOwnerOrAdmin)
	collection.DeleteRule = ptr(ruleOwnerOrAdmin)
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "owner", CollectionId: users.Id, Required: true, MaxSelect: 1},
		&core.RelationField{Name: "config", CollectionId: configs.Id, Required: true, MaxSelect: 1},
		&core.RelationField{Name: "iteration", CollectionId: iterations.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "size_key", Required: true},
		&core.NumberField{Name: "width", Required: true},
		&core.NumberField{Name: "height", Required: true},
		&core.FileField{Name: "image", Required: true, MaxSize: 20 * 1024 * 1024, MaxSelect: 1},
		&core.TextField{Name: "prompt_used"},
		&core.TextField{Name: "model_used"},
		&core.TextField{Name: "candidate_id"},
	)
	return app.Save(collection)
}

func ensureEvaluations(app core.App, users *core.Collection) error {
	results, _ := app.FindCollectionByNameOrId("generation_results")
	iterations, _ := app.FindCollectionByNameOrId("iterations")
	collection := core.NewCollection(core.CollectionTypeBase, "evaluations")
	collection.ListRule = ptr(ruleLoggedIn)
	collection.ViewRule = ptr(ruleLoggedIn)
	collection.CreateRule = ptr(ruleLoggedIn)
	collection.UpdateRule = ptr(ruleOwnerOrAdmin)
	collection.DeleteRule = ptr(ruleOwnerOrAdmin)
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "owner", CollectionId: users.Id, Required: true, MaxSelect: 1},
		&core.RelationField{Name: "result", CollectionId: results.Id, Required: true, MaxSelect: 1},
		&core.RelationField{Name: "iteration", CollectionId: iterations.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "scorer_model", Required: true},
		&core.NumberField{Name: "overall_score", Required: true},
		&core.NumberField{Name: "composition_score"},
		&core.NumberField{Name: "color_score"},
		&core.NumberField{Name: "atmosphere_score"},
		&core.NumberField{Name: "commercial_score"},
		&core.TextField{Name: "positive_tags"},
		&core.TextField{Name: "negative_tags"},
		&core.TextField{Name: "suggestions"},
		&core.JSONField{Name: "raw_response"},
	)
	return app.Save(collection)
}

func ensureModelConfigs(app core.App, users *core.Collection) error {
	collection := core.NewCollection(core.CollectionTypeBase, "model_configs")
	// model_configs 只有 admin 可管理
	collection.ListRule = ptr(ruleLoggedIn)
	collection.ViewRule = ptr(ruleLoggedIn)
	collection.CreateRule = ptr("@request.auth.role = 'admin'")
	collection.UpdateRule = ptr("@request.auth.role = 'admin'")
	collection.DeleteRule = ptr("@request.auth.role = 'admin'")
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "owner", CollectionId: users.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "name", Required: true},
		&core.SelectField{Name: "model_type", Values: []string{"generation", "scoring"}, Required: true, MaxSelect: 1},
		&core.TextField{Name: "model_name", Required: true},
		&core.SelectField{Name: "api_mode", Values: []string{"dashscope-wan", "chat-completions", "images"}, MaxSelect: 1},
		&core.TextField{Name: "api_base_url"},
		&core.TextField{Name: "api_key"},
		&core.JSONField{Name: "default_params_json"},
		&core.BoolField{Name: "is_active"},
		&core.NumberField{Name: "sort_order"},
	)
	return app.Save(collection)
}

func ensureActivityTemplates(app core.App, users *core.Collection) error {
	collection := core.NewCollection(core.CollectionTypeBase, "activity_templates")
	collection.ListRule = ptr(ruleLoggedIn)
	collection.ViewRule = ptr(ruleLoggedIn)
	collection.CreateRule = ptr(ruleLoggedIn)
	collection.UpdateRule = ptr(ruleOwnerOrAdmin)
	collection.DeleteRule = ptr(ruleOwnerOrAdmin)
	collection.Fields = core.NewFieldsList(
		&core.RelationField{Name: "owner", CollectionId: users.Id, Required: true, MaxSelect: 1},
		&core.TextField{Name: "name", Required: true},
		&core.TextField{Name: "title"},
		&core.TextField{Name: "subtitle"},
		&core.TextField{Name: "button_text"},
		&core.TextField{Name: "activity_time"},
		&core.TextField{Name: "prompt", Required: true},
		&core.TextField{Name: "image_model"},
		&core.NumberField{Name: "sort_order"},
	)
	return app.Save(collection)
}

func ptr(s string) *string { return &s }

func ensureSuperuser(app core.App) error {
	email := "admin@banner.local"
	password := "BP2026!admin"

	// 检查是否已存在
	su, err := app.FindAuthRecordByEmail("_superusers", email)
	if err == nil && su != nil {
		return nil // 已存在，跳过
	}

	// 创建超级管理员
	collection, err := app.FindCollectionByNameOrId("_superusers")
	if err != nil {
		return err
	}

	record := core.NewRecord(collection)
	record.SetEmail(email)
	record.SetPassword(password)

	return app.Save(record)
}
