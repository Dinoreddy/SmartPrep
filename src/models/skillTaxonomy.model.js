import mongoose from "mongoose";

const subTopicSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  questionCount: {
    type: Number,
    default: 0,
  },
});

const skillTaxonomySchema = new mongoose.Schema(
  {
    skill: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    subTopics: [subTopicSchema],
  },
  { timestamps: true }
);

export const SkillTaxonomy = mongoose.model("SkillTaxonomy", skillTaxonomySchema);
